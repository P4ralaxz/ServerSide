import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { qrPng, scanUrl } from '../../src/modules/assets/asset-qr';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3100';

// GET /assets/:id/qr (DESIGN 6.8, 7) — สติกเกอร์ติดครุภัณฑ์ ลิงก์ไปหน้าสแกน /app/scan/:qrToken
describe('QR ของครุภัณฑ์', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: { student: string; tech: string; staff: string; admin: string; ac1: string; lift1: string };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
    await app.close();
  });
  beforeEach(async () => {
    await truncateAll(ds);
    resetThrottle(app);
    const d1 = await makeBuilding(ds, 'Q1');
    const room1 = await makeRoom(ds, d1, '401');
    fx = {
      student: await makeUser(ds, { roomId: room1 }),
      tech: await makeUser(ds, { role: 'technician' }),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
      ac1: await makeAsset(ds, d1, room1, 'AC-D1-401'),
      lift1: await makeAsset(ds, d1, null, 'LIFT-D1-01'),
    };
  });

  const qr = async (assetId: string, who = fx.staff) =>
    request(app.getHttpServer())
      .get(`/assets/${assetId}/qr`)
      .set(await bearer(app, who))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  // @parity test_png_is_a_real_png — P*: GET /assets/:id/qr
  it('ได้ PNG จริง พร้อมบอกลิงก์ที่อยู่ในภาพใน X-Scan-Url', async () => {
    const res = await qr(fx.ac1);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((res.body as Buffer).subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(res.headers['x-scan-url']).toBe(`${BASE_URL}/app/scan/qr-${fx.ac1}`);
  });

  // @parity test_qr_holds_only_a_scan_url — P*: ลิงก์ชี้ /app/scan/<qr_token> ไม่ใช่ asset_code
  // ภาพสร้างแบบกำหนดได้ — เทียบกับภาพของลิงก์ที่คาดไว้ตรง ๆ จึงรู้ว่าในภาพมีแค่ลิงก์นั้น
  it('ในภาพมีแค่ลิงก์ไปหน้าสแกนด้วย qr_token — ไม่มีรหัสครุภัณฑ์หรือข้อมูลอื่น', async () => {
    const res = await qr(fx.lift1);
    const expected = scanUrl(BASE_URL, `qr-${fx.lift1}`);
    expect(res.body).toEqual(await qrPng(expected));
    expect(expected).not.toContain('LIFT-D1-01');
  });

  it('scanUrl ไม่ต่อ / ซ้อน และ escape token', () => {
    expect(scanUrl('https://dorm.example/', 'a b')).toBe('https://dorm.example/app/scan/a%20b');
  });

  it('admin พิมพ์ได้เหมือน staff · นักศึกษาและช่าง → 403', async () => {
    expect((await qr(fx.ac1, fx.admin)).status).toBe(200);
    expect((await qr(fx.ac1, fx.student)).status).toBe(403);
    expect((await qr(fx.ac1, fx.tech)).status).toBe(403);
  });

  // @parity test_unknown_code_is_404 — กันพิมพ์สติกเกอร์ที่สแกนแล้วเจอ 404 ไปติดหน้างาน
  it('ครุภัณฑ์ที่ไม่มี → 404 · id ผิดรูป → 400', async () => {
    expect((await qr('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await qr('not-a-uuid')).status).toBe(400);
  });

  // @parity test_deleted_asset_has_no_qr
  it('ครุภัณฑ์ที่ถูกลบแล้ว → 404', async () => {
    await ds.query(`UPDATE assets SET deleted_at = now() WHERE id = $1`, [fx.ac1]);
    expect((await qr(fx.ac1)).status).toBe(404);
  });

  // @parity test_qr_requires_login
  it('ต้อง login', async () => {
    expect((await request(app.getHttpServer()).get(`/assets/${fx.ac1}/qr`)).status).toBe(401);
  });
});
