import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, FakeMailService, resetThrottle } from '../setup/app';
import { openTestDb, truncateAll } from '../setup/truncate';

// รันหลัง tunnel (cloudflared / ngrok) บนเครื่องเดียวกัน: ทุก request ต่อเข้ามาจาก 127.0.0.1
// โควตาต่อ IP ของการขอรหัส (REQUESTS_PER_IP_PER_HOUR) และ throttler ต้องนับตาม IP จริงของผู้ใช้จาก X-Forwarded-For
// ไม่งั้นผู้ใช้ทั้งระบบใช้โควตาก้อนเดียวกัน — คนที่ 31 ของชั่วโมงขอรหัสไม่ได้
// เทสอ่าน IP ที่แอปเห็นจาก login_codes.requested_ip (OtpService บันทึก req.ip ตรง ๆ)
describe('TRUST_PROXY — IP ของผู้ใช้เมื่อรันหลัง tunnel', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
  });
  beforeEach(async () => {
    await truncateAll(ds);
  });

  const requestedIps = async (): Promise<string[]> =>
    (await ds.query(`SELECT host(requested_ip) AS ip FROM login_codes ORDER BY id`)).map((r: { ip: string }) => r.ip);

  const ask = (app: INestApplication, email: string, forwardedFor: string) =>
    request(app.getHttpServer())
      .post('/auth/request-code')
      .set('X-Forwarded-For', forwardedFor)
      .send({ email })
      .expect(202);

  describe('เปิด TRUST_PROXY', () => {
    let app: INestApplication;
    let mail: FakeMailService;
    beforeAll(async () => {
      ({ app, mail } = await createTestApp([], { trustProxy: true }));
    });
    afterAll(async () => {
      await app.close();
    });
    beforeEach(() => {
      resetThrottle(app);
      mail.reset();
    });

    it('IP ที่บันทึกเป็นของผู้ใช้จาก X-Forwarded-For ไม่ใช่ของ tunnel', async () => {
      await ask(app, 'a@kmitl.ac.th', '203.0.113.7');
      await ask(app, 'b@kmitl.ac.th', '198.51.100.20');
      expect(await requestedIps()).toEqual(['203.0.113.7', '198.51.100.20']);
    });

    it('header หลาย hop ใช้ตัวที่ proxy ใกล้สุดใส่ (ขวาสุด) — ค่าที่ผู้ใช้ปลอมไว้ทางซ้ายไม่มีผล', async () => {
      await ask(app, 'a@kmitl.ac.th', '1.2.3.4, 203.0.113.7');
      expect(await requestedIps()).toEqual(['203.0.113.7']);
    });
  });

  describe('ไม่เปิด (ค่าเริ่มต้น)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      ({ app } = await createTestApp());
    });
    afterAll(async () => {
      await app.close();
    });

    it('ไม่เชื่อ X-Forwarded-For — คนต่อตรงปลอม header เพื่อหนีโควตาต่อ IP ไม่ได้', async () => {
      await ask(app, 'a@kmitl.ac.th', '203.0.113.7');
      const [ip] = await requestedIps();
      expect(ip).toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);
    });
  });
});
