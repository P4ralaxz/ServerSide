import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../../src/common/auth/decorators';
import { User } from '../../src/database/entities';
import { createTestApp, FakeMailService, resetThrottle, tokenFor } from '../setup/app';
import { makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const EMAIL = '66070001@kmitl.ac.th';

// endpoint จำลองสำหรับทดสอบ RolesGuard โดยไม่พึ่งโมดูลอื่น (ของเดิมใช้แอปเล็กแยกด้วยเหตุผลเดียวกัน)
@Controller('probe')
class StaffOnlyController {
  @Get('staff-only')
  @Roles('staff', 'admin')
  staffOnly(@CurrentUser() user: User): { role: string } {
    return { role: user.role };
  }
}

describe('auth', () => {
  let app: INestApplication;
  let mail: FakeMailService;
  let ds: DataSource;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp([StaffOnlyController]));
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
    await app.close();
  });
  beforeEach(async () => {
    await truncateAll(ds);
    mail.reset();
    resetThrottle(app);
  });

  const http = () => request(app.getHttpServer());
  const requestCode = (email = EMAIL) => http().post('/auth/request-code').send({ email });
  const verify = (code: string, email = EMAIL) => http().post('/auth/verify-code').send({ email, code });
  const me = (token: string) => http().get('/auth/me').set('Authorization', `Bearer ${token}`);
  const wrong = (code: string): string => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  // ขยับเวลาของรหัสที่ขอไปแล้วให้พ้นช่วงพัก 60 วินาที (ยังอยู่ในหน้าต่าง 1 ชั่วโมง)
  const passCooldown = () => ds.query(`UPDATE login_codes SET created_at = created_at - interval '61 seconds'`);

  const login = async (email = EMAIL): Promise<string> => {
    await requestCode(email).expect(202);
    const res = await verify(mail.last(), email).expect(200);
    return res.body.access_token as string;
  };

  const codes = (): Promise<
    { code_hash: string; attempts: number; consumed_at: Date | null; requested_ip: string }[]
  > => ds.query(`SELECT code_hash, attempts, consumed_at, requested_ip::text FROM login_codes ORDER BY id`);

  describe('POST /auth/request-code', () => {
    // @parity test_request_code_returns_202_and_sends_code
    it('ตอบ 202 และส่งรหัส 6 หลักไปที่อีเมล', async () => {
      await requestCode().expect(202);
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0].email).toBe(EMAIL);
      expect(mail.outbox[0].code).toMatch(/^\d{6}$/);
    });

    // @parity test_request_code_same_response_for_known_and_unknown_email
    it('อีเมลที่มีบัญชีกับไม่มีบัญชี ตอบเหมือนกันทั้ง status และ body', async () => {
      await makeUser(ds, { email: 'staff.dorm@kmitl.ac.th', role: 'staff' });
      const known = await requestCode('staff.dorm@kmitl.ac.th');
      const unknown = await requestCode('nobody@kmitl.ac.th');
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(known.body).toEqual(unknown.body);
      expect(Object.keys(known.body)).toEqual(['message']);
    });

    it('บัญชีที่ถูกระงับหรือถูกลบ ก็ตอบเหมือนอีเมลทั่วไป', async () => {
      const suspended = await makeUser(ds, { email: 'gone@kmitl.ac.th' });
      await ds.query(`UPDATE users SET is_active = false WHERE id = $1`, [suspended]);
      const a = await requestCode('gone@kmitl.ac.th');
      const b = await requestCode('nobody@kmitl.ac.th');
      expect([a.status, a.body]).toEqual([b.status, b.body]);
    });

    // @parity test_request_code_rejects_non_university_email ×3
    it.each(['someone@gmail.com', 'x@student.kmitl.ac.th', 'ไม่ใช่อีเมล'])('ปฏิเสธ %s ด้วย 400', async (email) => {
      const res = await requestCode(email).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(mail.outbox).toEqual([]);
    });

    // @parity test_code_is_stored_hashed_not_plain — P*: HMAC ด้วย OTP_SECRET แยกจาก JWT_SECRET
    it('เก็บรหัสเป็น HMAC ไม่เก็บตัวรหัส', async () => {
      await requestCode().expect(202);
      const [row] = await codes();
      expect(row.code_hash).not.toBe(mail.last());
      expect(row.code_hash).not.toContain(mail.last());
      expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('รหัสเดียวกันของสองอีเมลได้ hash คนละค่า และไม่ใช่ sha256 เปล่า', async () => {
      const { createHash } = await import('node:crypto');
      await requestCode().expect(202);
      const [row] = await codes();
      expect(row.code_hash).not.toBe(createHash('sha256').update(mail.last()).digest('hex'));
      expect(row.code_hash).not.toBe(createHash('sha256').update(`${EMAIL}:${mail.last()}`).digest('hex'));
    });

    it('บันทึก requested_ip ทุกครั้ง', async () => {
      await requestCode().expect(202);
      const [row] = await codes();
      expect(row.requested_ip).toMatch(/127\.0\.0\.1|::1/);
    });

    // @parity test_email_is_normalized_to_lowercase — P*: ขอด้วยตัวใหญ่ ยืนยันด้วยตัวเล็ก ได้บัญชีเดียว
    it('อีเมลไม่สนตัวพิมพ์: ขอด้วยตัวใหญ่ ยืนยันด้วยตัวเล็กได้ และได้บัญชีเดียว', async () => {
      await requestCode('66070001@KMITL.AC.TH').expect(202);
      expect(mail.outbox[0].email).toBe(EMAIL);
      await verify(mail.last(), EMAIL).expect(200);
      await passCooldown();
      await requestCode(EMAIL).expect(202);
      await verify(mail.last(), ' 66070001@Kmitl.ac.th ').expect(200);
      const users: unknown[] = await ds.query(`SELECT 1 FROM users`);
      expect(users).toHaveLength(1);
    });

    it('ขอซ้ำภายใน 60 วินาที → 429 พร้อม Retry-After', async () => {
      await requestCode().expect(202);
      const res = await requestCode().expect(429);
      expect(res.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
      expect(res.body.details.retry_after).toBeGreaterThan(0);
      expect(res.body.details.retry_after).toBeLessThanOrEqual(60);
      expect(Number(res.headers['retry-after'])).toBe(res.body.details.retry_after);
      expect(mail.outbox).toHaveLength(1);
    });

    // @parity test_request_code_rate_limited_per_email
    it('ต่ออีเมลไม่เกิน 5 ครั้งต่อชั่วโมง — อีเมลอื่นยังขอได้', async () => {
      for (let i = 0; i < 5; i++) {
        await requestCode().expect(202);
        await passCooldown();
      }
      const res = await requestCode().expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(60);
      await requestCode('66070002@kmitl.ac.th').expect(202);
    });

    // @parity test_request_code_rate_limited_per_ip — เดิมลดเพดานด้วย monkeypatch · ใหม่ยิงครบ 30 จริง
    it('ต่อ IP ไม่เกิน 30 ครั้งต่อชั่วโมง', async () => {
      for (let i = 0; i < 30; i++) await requestCode(`660710${String(i).padStart(2, '0')}@kmitl.ac.th`).expect(202);
      const res = await requestCode('66079999@kmitl.ac.th').expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(mail.outbox).toHaveLength(30);
    });

    it('เพดานต่อ IP ไม่ใช่ 5: คนที่ 6 ของหอ (IP เดียวกัน) ยังขอรหัสได้', async () => {
      for (let i = 1; i <= 6; i++) await requestCode(`6607200${i}@kmitl.ac.th`).expect(202);
    });

    // @parity test_rate_limit_window_expires
    it('พ้น 1 ชั่วโมงแล้วขอได้อีก', async () => {
      for (let i = 0; i < 5; i++) {
        await requestCode().expect(202);
        await passCooldown();
      }
      await requestCode().expect(429);
      await ds.query(`UPDATE login_codes SET created_at = now() - interval '61 minutes'`);
      await requestCode().expect(202);
    });

    it('คำขอที่ถูกจำกัดไม่สร้างรหัสใหม่ และไม่ทำให้รหัสเดิมใช้ไม่ได้', async () => {
      await requestCode().expect(202);
      const code = mail.last();
      await requestCode().expect(429);
      expect(await codes()).toHaveLength(1);
      await verify(code).expect(200);
    });

    it('ขอพร้อมกัน 10 request ของอีเมลเดียว → ผ่านแค่ 1 (นับในทรานแซกชันที่เข้าคิวกัน)', async () => {
      // อุ่น connection pool ของแอปให้ครบก่อน: ถ้า pool ยังเย็น request แรกจะทำเสร็จทั้งทรานแซกชัน
      // ระหว่างที่ตัวอื่นยังต่อ DB ไม่เสร็จ แล้วเทสจะผ่านเพราะจังหวะ ไม่ใช่เพราะมีการเข้าคิวจริง
      await Promise.all(Array.from({ length: 10 }, () => app.get(DataSource).query(`SELECT pg_sleep(0.05)`)));

      // ทำหลายรอบ: race เกิดไม่ทุกครั้ง รอบเดียวอาจผ่านเพราะโชค
      for (let round = 0; round < 5; round++) {
        const email = `6607400${round}@kmitl.ac.th`;
        const results = await Promise.all(Array.from({ length: 10 }, () => requestCode(email)));
        expect(results.map((r) => r.status).sort()).toEqual([202, ...Array<number>(9).fill(429)]);
        const rows: unknown[] = await ds.query(`SELECT 1 FROM login_codes WHERE email = $1`, [email]);
        expect(rows).toHaveLength(1);
      }
    });

    it('ส่งเมลไม่สำเร็จก็ยังตอบ 202 เหมือนเดิม (ไม่บอกผลการส่ง)', async () => {
      const ok = await requestCode('ok@kmitl.ac.th');
      mail.mode = 'fail';
      const failed = await requestCode('fail@kmitl.ac.th');
      expect([failed.status, failed.body]).toEqual([ok.status, ok.body]);
    });

    it('ไม่รอผลการส่งเมล: SMTP ค้างก็ตอบทันที', async () => {
      mail.mode = 'hang';
      await requestCode().timeout(3000).expect(202);
    });

    // @superseded test_dev_mode_prints_code / test_production_mode_never_prints_code
    // เดิมมีโหมดพิมพ์รหัสออกจอ · ใหม่ไม่มีโหมดนั้น: dev ดูรหัสใน Mailpit, e2e อ่านจาก MailService ตัวปลอม
    // สิ่งที่ยังต้องคุมคือ "รหัสไม่ไปอยู่ใน log" ไม่ว่ากรณีใด
    it('ไม่เขียนรหัสลง log แม้ตอนส่งเมลล้มเหลว', async () => {
      const lines: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        }),
      );
      try {
        mail.mode = 'fail';
        await requestCode().expect(202);
        await new Promise((r) => setImmediate(r));
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
      expect(lines.join('\n')).toContain('ส่งเมลรหัสไม่สำเร็จ');
      expect(lines.join('\n')).not.toContain(mail.last());
    });
  });

  describe('POST /auth/verify-code', () => {
    // @parity test_first_login_auto_provisions_student — P*: ไม่มี student_id / email_verified_at ใน schema ใหม่
    it('login ครั้งแรกสร้างบัญชี student ที่ยังไม่มีห้องให้', async () => {
      await requestCode().expect(202);
      const res = await verify(mail.last()).expect(200);
      expect(res.body.token_type).toBe('bearer');
      expect(res.body.user).toMatchObject({ email: EMAIL, role: 'student', room_id: null, is_active: true });
      const users: { role: string; room_id: string | null }[] = await ds.query(`SELECT role, room_id FROM users`);
      expect(users).toEqual([{ role: 'student', room_id: null }]);
    });

    it('JWT มีแค่ sub (กับ iat/exp) ไม่มี role หรืออีเมล และอายุ 8 ชั่วโมง', async () => {
      const token = await login();
      const payload = app.get(JwtService).decode<Record<string, unknown>>(token);
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
      expect((payload.exp as number) - (payload.iat as number)).toBe(8 * 3600);
    });

    // @parity test_login_keeps_role_assigned_by_admin
    it('บัญชีที่ Admin สร้างไว้ login แล้วคง role เดิม ไม่กลายเป็น student', async () => {
      await makeUser(ds, { email: 'tech.fai@kmitl.ac.th', role: 'technician' });
      const token = await login('tech.fai@kmitl.ac.th');
      const res = await me(token).expect(200);
      expect(res.body.role).toBe('technician');
      const users: unknown[] = await ds.query(`SELECT 1 FROM users`);
      expect(users).toHaveLength(1);
    });

    it('บัญชีที่ถูกลบแบบ soft ไปแล้ว login ใหม่ได้บัญชีใหม่ ไม่ปลุกบัญชีเก่า', async () => {
      const old = await makeUser(ds, { email: EMAIL, role: 'staff' });
      await ds.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [old]);
      await requestCode().expect(202);
      const res = await verify(mail.last()).expect(200);
      expect(res.body.user.id).not.toBe(old);
      expect(res.body.user.role).toBe('student');
    });

    // @parity test_wrong_code_counts_attempts_then_locks — P*: รหัสผิดตอบ 401 (เดิม 400) · ล็อกแล้ว 429 เหมือนเดิม
    it('รหัสผิดนับ attempts — ครบ 5 ครั้งแล้วรหัสถูกก็ใช้ไม่ได้', async () => {
      await requestCode().expect(202);
      const code = mail.last();
      for (let i = 0; i < 5; i++) {
        const res = await verify(wrong(code)).expect(401);
        expect(res.body.code).toBe('INVALID_CODE');
      }
      expect((await codes())[0].attempts).toBe(5);

      const locked = await verify(code).expect(429);
      expect(locked.body.code).toBe('CODE_LOCKED');
      expect((await codes())[0].attempts).toBe(5);
      const users: unknown[] = await ds.query(`SELECT 1 FROM users`);
      expect(users).toHaveLength(0);
    });

    it('ผิด 4 ครั้งแล้วถูกครั้งที่ 5 ยังเข้าได้', async () => {
      await requestCode().expect(202);
      const code = mail.last();
      for (let i = 0; i < 4; i++) await verify(wrong(code)).expect(401);
      await verify(code).expect(200);
    });

    it('ล็อกแล้วขอรหัสใหม่ก็กลับมาใช้ได้', async () => {
      await requestCode().expect(202);
      for (let i = 0; i < 5; i++) await verify(wrong(mail.last())).expect(401);
      await passCooldown();
      await requestCode().expect(202);
      await verify(mail.last()).expect(200);
    });

    // @parity test_expired_code_rejected
    it('รหัสหมดอายุใช้ไม่ได้ (อายุ 10 นาที)', async () => {
      await requestCode().expect(202);
      const [row]: { ttl: number }[] = await ds.query(
        `SELECT round(extract(epoch FROM expires_at - created_at))::int AS ttl FROM login_codes`,
      );
      expect(row.ttl).toBe(600);
      await ds.query(`UPDATE login_codes SET expires_at = now() - interval '1 second'`);
      await verify(mail.last()).expect(401);
    });

    // @parity test_code_is_single_use
    it('รหัสใช้ได้ครั้งเดียว', async () => {
      await requestCode().expect(202);
      const code = mail.last();
      await verify(code).expect(200);
      await verify(code).expect(401);
    });

    // @parity test_new_code_replaces_old_one
    it('ขอรหัสใหม่แล้วรหัสเก่าใช้ไม่ได้', async () => {
      await requestCode().expect(202);
      const oldCode = mail.last();
      await passCooldown();
      await requestCode().expect(202);
      const newCode = mail.last();
      if (oldCode !== newCode) await verify(oldCode).expect(401);
      await verify(newCode).expect(200);
    });

    // @parity test_verify_without_request_rejected
    it('ยืนยันโดยไม่เคยขอรหัส → 401', async () => {
      await verify('123456').expect(401);
    });

    it('รหัสของอีเมลอื่นใช้กับอีเมลนี้ไม่ได้', async () => {
      await requestCode('other@kmitl.ac.th').expect(202);
      const otherCode = mail.last();
      await requestCode(EMAIL).expect(202);
      if (otherCode !== mail.last()) await verify(otherCode, EMAIL).expect(401);
    });

    // @parity test_verify_bad_code_format_is_400
    it.each(['12ab56', '12345', '1234567', ''])('รูปแบบรหัสผิด (%p) → 400 โดยไม่นับ attempts', async (code) => {
      await requestCode().expect(202);
      const res = await verify(code).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect((await codes())[0].attempts).toBe(0);
    });

    // @parity test_inactive_user_cannot_login — เดิม 403 · ใช้ 401 ให้ตรงกับ guard (DESIGN ตาราง 7) รอยืนยัน
    it('บัญชีที่ถูกระงับ login ไม่ได้ แม้รหัสถูก', async () => {
      const id = await makeUser(ds, { email: EMAIL });
      await ds.query(`UPDATE users SET is_active = false WHERE id = $1`, [id]);
      await requestCode().expect(202);
      const res = await verify(mail.last()).expect(401);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
      expect(res.body.access_token).toBeUndefined();
    });

    it('ต่อ IP ยืนยันได้ไม่เกิน 60 ครั้งต่อชั่วโมง', async () => {
      for (let i = 0; i < 60; i++) await verify('000000', `66073${String(i).padStart(3, '0')}@kmitl.ac.th`).expect(401);
      const res = await verify('000000', 'last@kmitl.ac.th').expect(429);
      expect(res.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests', code: 'RATE_LIMITED' });
    });
  });

  describe('concurrency', () => {
    it('ยิงรหัสผิดพร้อมกัน 20 request → attempts ไม่เกิน 5 และหลังจากนั้นรหัสถูกก็ใช้ไม่ได้', async () => {
      await requestCode().expect(202);
      const code = mail.last();

      const results = await Promise.all(Array.from({ length: 20 }, () => verify(wrong(code))));
      expect(results.filter((r) => r.status === 401)).toHaveLength(5);
      expect(results.filter((r) => r.status === 429)).toHaveLength(15);
      expect(results.filter((r) => r.status === 200)).toHaveLength(0);
      expect((await codes())[0].attempts).toBe(5);

      await verify(code).expect(429);
    });

    it('ใช้รหัสเดียวกันยืนยันพร้อมกัน 2 request → ได้ JWT แค่ 1', async () => {
      await requestCode().expect(202);
      const code = mail.last();
      const results = await Promise.all([verify(code), verify(code)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      expect(results.filter((r) => typeof r.body.access_token === 'string')).toHaveLength(1);
      const users: unknown[] = await ds.query(`SELECT 1 FROM users`);
      expect(users).toHaveLength(1);
    });
  });

  describe('JwtAuthGuard + GET /auth/me', () => {
    // @parity test_me_requires_token
    it('ไม่มี token → 401 ในรูปแบบ error ของระบบ', async () => {
      const res = await http().get('/auth/me').expect(401);
      expect(res.body).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        message: expect.any(String),
      });
    });

    // @parity test_me_rejects_bad_token ×3
    it.each(['Bearer not-a-token', 'Bearer abc.def.ghi', 'Basic xyz', 'Bearer '])('header %p → 401', async (header) => {
      await http().get('/auth/me').set('Authorization', header).expect(401);
    });

    // @parity test_me_rejects_expired_token — P*: อายุ token 8 ชม. (เดิม 1 วัน)
    it('token หมดอายุ → 401', async () => {
      const id = await makeUser(ds);
      const expired = await app.get(JwtService).signAsync({ sub: id }, { expiresIn: -60 });
      await me(expired).expect(401);
    });

    // @parity test_me_rejects_token_signed_with_other_secret
    it('token ที่เซ็นด้วย secret อื่น → 401 ส่วน token จริงยังใช้ได้', async () => {
      const token = await login();
      const [{ id }]: { id: string }[] = await ds.query(`SELECT id FROM users`);
      const forged = await new JwtService({ secret: 'not-the-secret-not-the-secret-not-the-secret' }).signAsync({
        sub: id,
      });
      await me(forged).expect(401);
      await me(token).expect(200);
    });

    it('token แบบ alg=none หรือ sub ที่ไม่ใช่ uuid → 401 ไม่ใช่ 400/500', async () => {
      const [{ id }]: { id: string }[] = await ds.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [EMAIL]);
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: id })}.`;
      await me(none).expect(401);
      await me(await app.get(JwtService).signAsync({ sub: 'abc' })).expect(401);
      await me(await app.get(JwtService).signAsync({})).expect(401);
    });

    it('token ของ user ที่ไม่มีอยู่ → 401', async () => {
      await me(await tokenFor(app, '00000000-0000-4000-8000-000000000000')).expect(401);
    });

    // @parity test_suspended_after_login_blocked_immediately — P*: guard ตอบ 401 (เดิม 403)
    it('ระงับบัญชีแล้ว token เดิมใช้ไม่ได้ทันที', async () => {
      const token = await login();
      await me(token).expect(200);
      await ds.query(`UPDATE users SET is_active = false`);
      await me(token).expect(401);
    });

    it('ลบบัญชีแบบ soft แล้ว token เดิมใช้ไม่ได้ทันที', async () => {
      const token = await login();
      await ds.query(`UPDATE users SET deleted_at = now()`);
      await me(token).expect(401);
    });

    it('/auth/me อ่านข้อมูลจาก DB ทุกครั้ง ไม่ใช่จาก token', async () => {
      const token = await login();
      await ds.query(`UPDATE users SET full_name = 'ชื่อใหม่'`);
      const res = await me(token).expect(200);
      expect(res.body.full_name).toBe('ชื่อใหม่');
    });
  });

  describe('RolesGuard', () => {
    const staffOnly = (token?: string) => {
      const req = http().get('/probe/staff-only');
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    // @parity test_role_guard_blocks_student_with_403
    it('student → 403 ในรูปแบบ error ของระบบ', async () => {
      const res = await staffOnly(await login()).expect(403);
      expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', code: 'FORBIDDEN', message: expect.any(String) });
    });

    // @parity test_role_guard_allows_staff
    it('staff → 200', async () => {
      await makeUser(ds, { email: 'staff.dorm@kmitl.ac.th', role: 'staff' });
      const res = await staffOnly(await login('staff.dorm@kmitl.ac.th')).expect(200);
      expect(res.body).toEqual({ role: 'staff' });
    });

    // @parity test_role_change_takes_effect_without_new_token
    it('เปลี่ยน role ใน DB แล้ว token เดิมได้สิทธิ์ใหม่ทันที ทั้งเลื่อนขึ้นและถอดลง', async () => {
      const token = await login();
      await staffOnly(token).expect(403);
      await ds.query(`UPDATE users SET role = 'staff'`);
      await staffOnly(token).expect(200);
      await ds.query(`UPDATE users SET role = 'student'`);
      await staffOnly(token).expect(403);
    });

    // @parity test_role_guard_without_token_is_401
    it('ไม่มี token → 401 ไม่ใช่ 403', async () => {
      await staffOnly().expect(401);
    });
  });

  describe('ค่าเริ่มต้นของทั้งระบบ', () => {
    it('endpoint ที่ไม่ได้ประกาศ @Public ต้องมี token เสมอ', async () => {
      for (const path of ['/users', '/buildings', '/rooms', '/assets']) await http().get(path).expect(401);
    });

    it('/health เปิดได้โดยไม่ต้อง login', async () => {
      await http().get('/health').expect(200);
    });
  });
});
