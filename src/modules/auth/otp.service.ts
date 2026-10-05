import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AppException } from '../../common/errors/domain-errors';
import { Env } from '../../config/env';
import { MailService } from './mail.service';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const REQUEST_COOLDOWN_SECONDS = 60;
export const REQUESTS_PER_EMAIL_PER_HOUR = 5;
// ไม่ใช่ 5: ทั้งหออยู่หลัง NAT เดียวกัน ถ้าจำกัดเท่าต่ออีเมล คนที่ 6 ของหอจะขอรหัสไม่ได้
export const REQUESTS_PER_IP_PER_HOUR = 30;

const rateLimited = (retryAfter: number): AppException =>
  new AppException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'ขอรหัสถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', {
    retry_after: Math.max(1, Math.ceil(retryAfter)),
  });

const invalidCode = (): AppException =>
  new AppException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว');

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly secret: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('OTP_SECRET', { infer: true });
  }

  // HMAC ไม่ใช่ sha256 เปล่า: รหัสมีแค่ 10^6 แบบ ถ้า dump ตารางหลุด hash เปล่า ๆ ไล่ครบได้ในเสี้ยววินาที
  // ผูกอีเมลเข้าไปด้วย รหัสเดียวกันของสองคนจะได้ hash คนละค่า
  private hash(email: string, code: string): string {
    return createHmac('sha256', this.secret).update(`${email}:${code}`).digest('hex');
  }

  async requestCode(email: string, ip: string | null): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.dataSource.transaction(async (m) => {
      // ตัวนับอ่านจาก login_codes เอง ไม่มี Redis — จึงต้องเข้าคิวต่ออีเมล/ต่อ IP ก่อนนับ
      // ไม่งั้นคำขอที่มาพร้อมกันจะนับจากภาพเดียวกันแล้วผ่านเกินโควตาทุกตัว (lock ปลดเองตอนจบทรานแซกชัน)
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('otp:email:' || $1))`, [email]);
      if (ip) await m.query(`SELECT pg_advisory_xact_lock(hashtext('otp:ip:' || $1))`, [ip]);

      const [byEmail]: { n: number; since_last: number | null; until_free: number | null }[] = await m.query(
        `SELECT count(*)::int AS n,
                extract(epoch FROM now() - max(created_at))::float AS since_last,
                extract(epoch FROM min(created_at) + interval '1 hour' - now())::float AS until_free
         FROM login_codes WHERE email = $1 AND created_at > now() - interval '1 hour'`,
        [email],
      );
      if (byEmail.since_last !== null && byEmail.since_last < REQUEST_COOLDOWN_SECONDS) {
        throw rateLimited(REQUEST_COOLDOWN_SECONDS - byEmail.since_last);
      }
      if (byEmail.n >= REQUESTS_PER_EMAIL_PER_HOUR) throw rateLimited(byEmail.until_free ?? 3600);

      if (ip) {
        const [byIp]: { n: number; until_free: number | null }[] = await m.query(
          `SELECT count(*)::int AS n,
                  extract(epoch FROM min(created_at) + interval '1 hour' - now())::float AS until_free
           FROM login_codes WHERE requested_ip = $1::inet AND created_at > now() - interval '1 hour'`,
          [ip],
        );
        if (byIp.n >= REQUESTS_PER_IP_PER_HOUR) throw rateLimited(byIp.until_free ?? 3600);
      }

      // รหัสเก่าของอีเมลนี้ใช้ไม่ได้ทันทีที่ขอใหม่ — มีรหัสที่ใช้ได้พร้อมกันแค่ตัวเดียวเสมอ
      await m.query(`UPDATE login_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL`, [email]);
      await m.query(
        `INSERT INTO login_codes (email, code_hash, expires_at, requested_ip)
         VALUES ($1, $2, now() + make_interval(mins => $3), $4::inet)`,
        [email, this.hash(email, code), OTP_TTL_MINUTES, ip],
      );
    });

    // ไม่รอผลการส่ง: ถ้ารอ เวลาตอบจะบอกได้ว่าอีเมลไหนส่งสำเร็จ และ SMTP ช้าจะลาก request ไปด้วย
    // ห้าม log ตัวรหัส — log เป็นที่ที่คนเข้าถึงได้กว้างกว่ากล่องเมลของเจ้าของ
    void this.mail
      .sendLoginCode(email, code)
      .catch((e: unknown) => this.logger.warn(`ส่งเมลรหัสไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`));
  }

  // คืน true เมื่อรหัสถูกและยังไม่ถูกใช้ — โยน 401/429 ในกรณีอื่นทั้งหมด
  async consumeCode(email: string, code: string): Promise<void> {
    // นับก่อนเทียบ ในคำสั่งเดียว: row lock ของ UPDATE ทำให้ 20 request ที่มาพร้อมกันต้องเข้าคิว
    // และเงื่อนไข attempts < 5 ถูกตรวจซ้ำกับค่าล่าสุดหลังได้ lock
    // ถ้าแยกเป็น SELECT แล้ว UPDATE ทุก request จะอ่าน attempts ค่าเดียวกันและผ่านหมด
    const counted: [{ id: string; code_hash: string }[], number] = await this.dataSource.query(
      `UPDATE login_codes SET attempts = attempts + 1
       WHERE id = (SELECT id FROM login_codes
                   WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
                   ORDER BY created_at DESC, id DESC LIMIT 1)
         AND attempts < $2
       RETURNING id, code_hash`,
      [email, OTP_MAX_ATTEMPTS],
    );
    const row = counted[0][0];

    if (!row) {
      // ไม่ได้แถว = ไม่มีรหัสที่ใช้ได้ หรือรหัสนั้นลองครบแล้ว — แยกสองกรณีเพื่อบอกผู้ใช้ให้ขอรหัสใหม่
      const locked: unknown[] = await this.dataSource.query(
        `SELECT 1 FROM login_codes
         WHERE email = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts >= $2 LIMIT 1`,
        [email, OTP_MAX_ATTEMPTS],
      );
      if (locked.length > 0) {
        throw new AppException(
          HttpStatus.TOO_MANY_REQUESTS,
          'CODE_LOCKED',
          'ลองรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่',
        );
      }
      throw invalidCode();
    }

    const expected = Buffer.from(row.code_hash, 'hex');
    const actual = Buffer.from(this.hash(email, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalidCode();

    // ใช้ได้ครั้งเดียว: verify สอง request พร้อมกันด้วยรหัสเดียวกัน มีแค่ตัวเดียวที่ได้แถวกลับมา
    const consumed: [unknown[], number] = await this.dataSource.query(
      `UPDATE login_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
      [row.id],
    );
    if (consumed[0].length === 0) throw invalidCode();
  }
}
