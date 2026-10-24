import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bearer, createTestApp } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeUser } from '../setup/factories';
import { WEB_FIXTURE_INDEX } from '../setup/global-setup';
import { openTestDb, truncateAll } from '../setup/truncate';

// Nest เสิร์ฟหน้าเว็บที่ /app (UI-PLAN 1, 7) — QR ชี้มาที่ /app/scan/:qrToken ซึ่งต้องเปิดได้ก่อน login
// ตัวหน้า HTML ไม่มีข้อมูลของครุภัณฑ์เลย ข้อมูลมาจาก GET /scan/:qrToken ที่ต้องมี token (DESIGN 6.8)
describe('หน้าเว็บที่ /app', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: { student: string; qrToken: string };

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
    const b = await makeBuilding(ds, 'R1');
    const room = await makeRoom(ds, b, '401');
    const asset = await makeAsset(ds, b, room, 'AC-401');
    const [row]: { qr_token: string }[] = await ds.query(`SELECT qr_token FROM assets WHERE id = $1`, [asset]);
    fx = { student: await makeUser(ds, { roomId: room }), qrToken: row.qr_token };
  });

  const http = () => request(app.getHttpServer());

  // @parity test_scan_page_opens_without_login — P: หน้า HTML เปิดได้ ส่วน API ยังต้อง login
  it('/app/scan/:qrToken เปิดได้โดยไม่มี token — ได้ index.html ของ SPA', async () => {
    const res = await http().get(`/app/scan/${fx.qrToken}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toBe(WEB_FIXTURE_INDEX);
    // ข้อมูลจริงยังต้อง login
    await http().get(`/scan/${fx.qrToken}`).expect(401);
  });

  // @parity test_scan_page_carries_no_data_of_its_own
  it('หน้า HTML ไม่มีข้อมูลของครุภัณฑ์ในตัว — ทุก path ใต้ /app ได้ไฟล์เดียวกันทุกไบต์', async () => {
    const scan = await http().get(`/app/scan/${fx.qrToken}`).expect(200);
    const home = await http().get('/app/').expect(200);
    const deep = await http().get('/app/tickets/00000000-0000-0000-0000-000000000000').expect(200);
    expect(scan.text).toBe(home.text);
    expect(deep.text).toBe(home.text);
    expect(scan.text).not.toContain('AC-401');
    expect(scan.text).not.toContain(fx.qrToken);
  });

  // @parity test_scan_page_of_unknown_code_still_opens — P: หน้าเว็บไม่เช็ครหัส 404 อยู่ที่ API
  it('รหัสที่ไม่มีจริงก็ได้หน้าเดียวกัน — 404 อยู่ที่ API ไม่ใช่หน้าเว็บ', async () => {
    const page = await http().get('/app/scan/no-such-token').expect(200);
    expect(page.text).toBe(WEB_FIXTURE_INDEX);
    const api = await http()
      .get('/scan/no-such-token')
      .set(await bearer(app, fx.student))
      .expect(404);
    expect(api.body.code).toBe('NOT_FOUND');
  });

  it('ไฟล์ของ build เสิร์ฟตามชนิดไฟล์', async () => {
    const js = await http().get('/app/assets/index.js').expect(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
  });

  it('path ของ API ไม่เปลี่ยน — ไม่มี token ยังได้ 401 JSON และ path ที่ไม่มีได้ 404 JSON ไม่ใช่ index.html', async () => {
    const tickets = await http().get('/tickets').expect(401);
    expect(tickets.body.code).toBe('UNAUTHORIZED');
    const missing = await http().get('/no-such-path').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    await http().get('/health').expect(200);
  });
});
