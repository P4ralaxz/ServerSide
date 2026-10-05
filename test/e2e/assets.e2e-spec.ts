import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OPEN_STATUSES } from '../../src/domain/status-rules';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser, ticketNoOf } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

describe('assets', () => {
  let app: INestApplication;
  let ds: DataSource;
  let d1: string;
  let d2: string;
  let people: { student: string; tech: string; staff: string; admin: string };

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
    d1 = await makeBuilding(ds, 'D1');
    d2 = await makeBuilding(ds, 'D2');
    people = {
      student: await makeUser(ds),
      tech: await makeUser(ds, { role: 'technician' }),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  const body = (over: object = {}) => ({
    asset_code: 'WM-D1-03',
    name: 'เครื่องซักผ้า 3',
    category: 'appliance',
    ...over,
  });
  const create = async (over: object = {}) =>
    http()
      .post('/assets')
      .set(await as(people.staff))
      .send(body(over));

  // @parity test_create_common_area_asset_needs_building — P*: building_id
  it('ครุภัณฑ์ส่วนกลางต้องระบุอาคาร', async () => {
    const missing = await create();
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('BUILDING_REQUIRED');

    const res = await create({ building_id: d1, location_note: 'ห้องซักล้างชั้น 1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      asset_code: 'WM-D1-03',
      building_id: d1,
      room_id: null,
      is_common_area: true,
      location_note: 'ห้องซักล้างชั้น 1',
    });
  });

  it('สร้างแล้วได้ qr_token ที่สุ่มมา ไม่ซ้ำกัน และไม่ได้มาจากรหัสครุภัณฑ์', async () => {
    const a = await create({ building_id: d1 });
    const b = await create({ building_id: d1, asset_code: 'WM-D1-04' });
    expect(a.body.qr_token).toMatch(/^[0-9a-f]{32}$/);
    expect(b.body.qr_token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.body.qr_token).not.toBe(b.body.qr_token);
    // ผู้ใช้กำหนด qr_token เองไม่ได้
    expect((await create({ building_id: d1, asset_code: 'X', qr_token: 'guess-me' })).status).toBe(400);
  });

  // @parity test_in_room_asset_takes_building_from_room
  it('ครุภัณฑ์ในห้องใช้อาคารของห้อง — ระบุอาคารไม่ตรงกับห้อง → 400', async () => {
    const room = await makeRoom(ds, d2, '501');
    const res = await create({ room_id: room });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ building_id: d2, room_id: room, is_common_area: false });

    const wrong = await create({ asset_code: 'X-1', room_id: room, building_id: d1 });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('BUILDING_MISMATCH');
  });

  // @parity test_asset_unknown_room_is_400
  it('ห้องที่ไม่มีอยู่ หรือถูกลบแบบ soft → 400', async () => {
    const gone = await makeRoom(ds, d1, '402');
    await ds.query(`UPDATE rooms SET deleted_at = now() WHERE id = $1`, [gone]);
    for (const room_id of ['00000000-0000-4000-8000-000000000000', gone]) {
      const res = await create({ room_id });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ROOM_NOT_FOUND');
    }
    expect((await create({ building_id: '00000000-0000-4000-8000-000000000000' })).body.code).toBe(
      'BUILDING_NOT_FOUND',
    );
  });

  // @parity test_duplicate_asset_code_is_409
  it('รหัสครุภัณฑ์ซ้ำ → 409 · ลบแบบ soft แล้วใช้รหัสเดิมได้', async () => {
    const first = await create({ building_id: d1 });
    const dup = await create({ building_id: d1 });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'UNIQUE_VIOLATION', details: { constraint: 'uq_assets_code' } });

    await http()
      .delete(`/assets/${first.body.id}`)
      .set(await as(people.staff))
      .expect(204);
    expect((await create({ building_id: d1 })).status).toBe(201);
  });

  // @parity test_student_cannot_write_assets
  it.each(['student', 'tech'] as const)('%s เขียนครุภัณฑ์ไม่ได้ → 403', async (who) => {
    const asset = await makeAsset(ds, d1);
    const h = await as(people[who]);
    await http()
      .post('/assets')
      .set(h)
      .send(body({ building_id: d1 }))
      .expect(403);
    await http()
      .put(`/assets/${asset}`)
      .set(h)
      .send(body({ building_id: d1 }))
      .expect(403);
    await http().patch(`/assets/${asset}`).set(h).send({ name: 'x' }).expect(403);
    await http().delete(`/assets/${asset}`).set(h).expect(403);
  });

  it('ต้อง login', async () => {
    await http().get('/assets').expect(401);
  });

  // @parity test_patch_moves_asset_to_common_area_keeping_building
  it('PATCH room_id: null ย้ายเป็นส่วนกลางโดยคงอาคารเดิม', async () => {
    const room = await makeRoom(ds, d2, '501');
    const asset = await makeAsset(ds, d2, room);
    const res = await http()
      .patch(`/assets/${asset}`)
      .set(await as(people.staff))
      .send({ room_id: null })
      .expect(200);
    expect(res.body).toMatchObject({ is_common_area: true, room_id: null, building_id: d2 });
  });

  it('PATCH ย้ายครุภัณฑ์เข้าห้องของอีกอาคาร อาคารเปลี่ยนตามห้อง', async () => {
    const room = await makeRoom(ds, d2, '501');
    const asset = await makeAsset(ds, d1);
    const res = await http()
      .patch(`/assets/${asset}`)
      .set(await as(people.staff))
      .send({ room_id: room })
      .expect(200);
    expect(res.body).toMatchObject({ room_id: room, building_id: d2, is_common_area: false });
  });

  it('PATCH เปลี่ยนอาคารของครุภัณฑ์ในห้องให้ไม่ตรงกับห้อง → 400', async () => {
    const room = await makeRoom(ds, d2, '501');
    const asset = await makeAsset(ds, d2, room);
    const res = await http()
      .patch(`/assets/${asset}`)
      .set(await as(people.staff))
      .send({ building_id: d1 })
      .expect(400);
    expect(res.body.code).toBe('BUILDING_MISMATCH');
  });

  // @parity test_patch_rejects_null_for_required_field
  it('PATCH ฟิลด์บังคับเป็น null → 400 ไม่ใช่ 500', async () => {
    const asset = await makeAsset(ds, d1);
    const h = await as(people.staff);
    for (const field of ['name', 'asset_code', 'category', 'building_id']) {
      const res = await http()
        .patch(`/assets/${asset}`)
        .set(h)
        .send({ [field]: null })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('PUT แทนที่ทั้งรายการ: ไม่ส่ง room_id / location_note = กลายเป็นส่วนกลางและล้างหมายเหตุ · qr_token คงเดิม', async () => {
    const room = await makeRoom(ds, d1, '401');
    const created = await create({ room_id: room, location_note: 'ข้างเตียง' });
    const h = await as(people.staff);

    await http().put(`/assets/${created.body.id}`).set(h).send({ name: 'ขาดฟิลด์' }).expect(400);
    const res = await http()
      .put(`/assets/${created.body.id}`)
      .set(h)
      .send({ asset_code: 'NEW-1', name: 'ชื่อใหม่', category: 'furniture', building_id: d1 })
      .expect(200);
    expect(res.body).toMatchObject({
      asset_code: 'NEW-1',
      name: 'ชื่อใหม่',
      category: 'furniture',
      room_id: null,
      location_note: null,
      qr_token: created.body.qr_token,
    });
  });

  // @parity test_soft_delete_asset
  it('ลบแบบ soft: อ่านไม่เจอแล้ว แต่แถวยังอยู่ให้ใบเก่าอ้างถึง', async () => {
    const asset = await makeAsset(ds, d1, null, 'LIFT-D1-01');
    const h = await as(people.staff);
    await http().delete(`/assets/${asset}`).set(h).expect(204);

    await http().get(`/assets/${asset}`).set(h).expect(404);
    expect((await http().get('/assets').set(h).expect(200)).body).toEqual([]);
    const [row]: { deleted_at: Date | null }[] = await ds.query(`SELECT deleted_at FROM assets WHERE id = $1`, [asset]);
    expect(row.deleted_at).not.toBeNull();
    await http().delete(`/assets/${asset}`).set(h).expect(404);
    await http().patch(`/assets/${asset}`).set(h).send({ name: 'x' }).expect(404);
  });

  describe('ลบครุภัณฑ์ที่มีใบแจ้งซ่อม', () => {
    // ใหม่ตาม DESIGN หัวข้อ 7 — ทุกสถานะใน OPEN_STATUSES ต้องกันการลบ
    it.each([...OPEN_STATUSES])('มีใบสถานะ %s → 409 พร้อม ticket_no', async (status) => {
      const asset = await makeAsset(ds, d1);
      const ticket = await makeTicket(ds, {
        assetId: asset,
        reporterId: people.student,
        status,
        ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
      });
      const res = await http()
        .delete(`/assets/${asset}`)
        .set(await as(people.staff))
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'ASSET_HAS_OPEN_TICKET',
        details: { tickets: [await ticketNoOf(ds, ticket)] },
      });
      const [row]: { deleted_at: Date | null }[] = await ds.query(`SELECT deleted_at FROM assets WHERE id = $1`, [
        asset,
      ]);
      expect(row.deleted_at).toBeNull();
    });

    it.each(['closed', 'rejected', 'cancelled'] as const)('มีแต่ใบ %s → ลบได้', async (status) => {
      const asset = await makeAsset(ds, d1);
      const done = new Date();
      await makeTicket(ds, {
        assetId: asset,
        reporterId: people.student,
        status,
        ...(status === 'closed' ? { resolvedAt: done, closedAt: done, closeReason: 'staff_confirmed' } : {}),
      });
      await http()
        .delete(`/assets/${asset}`)
        .set(await as(people.staff))
        .expect(204);
    });

    it('ใบเปิดที่ถูกลบแบบ soft ไม่กันการลบ', async () => {
      const asset = await makeAsset(ds, d1);
      await makeTicket(ds, { assetId: asset, reporterId: people.student, deletedAt: new Date() });
      await http()
        .delete(`/assets/${asset}`)
        .set(await as(people.staff))
        .expect(204);
    });
  });

  // @superseded test_asset_filters_and_qr_lookup — ส่วน filter แปลตรง ๆ
  // ส่วน /assets/by-code ถูกแทนด้วย GET /scan/:qrToken (สัปดาห์ 5)
  it('กรองตามส่วนกลาง / อาคาร / ห้อง / หมวด — ทุก role อ่านได้', async () => {
    const room = await makeRoom(ds, d1, '401');
    const inRoom = await makeAsset(ds, d1, room, 'AC-D1-401');
    const liftD1 = await makeAsset(ds, d1, null, 'LIFT-D1-01');
    const liftD2 = await makeAsset(ds, d2, null, 'LIFT-D2-01');
    await ds.query(`UPDATE assets SET category = 'elevator' WHERE id = ANY($1)`, [[liftD1, liftD2]]);
    const h = await as(people.student);

    const ids = async (query: object): Promise<string[]> =>
      ((await http().get('/assets').set(h).query(query).expect(200)).body as { id: string }[]).map((a) => a.id);

    expect(await ids({})).toEqual([inRoom, liftD1, liftD2]);
    expect(await ids({ common_area: true })).toEqual([liftD1, liftD2]);
    expect(await ids({ common_area: false })).toEqual([inRoom]);
    expect(await ids({ building_id: d2 })).toEqual([liftD2]);
    expect(await ids({ room_id: room })).toEqual([inRoom]);
    expect(await ids({ category: 'elevator', building_id: d1 })).toEqual([liftD1]);
    await http().get('/assets').set(h).query({ common_area: 'maybe' }).expect(400);
    await http().get(`/assets/${liftD2}`).set(h).expect(200);
  });

  it('qr_token ส่งให้เฉพาะ staff / admin', async () => {
    const asset = await makeAsset(ds, d1);
    for (const who of ['student', 'tech'] as const) {
      const h = await as(people[who]);
      expect((await http().get(`/assets/${asset}`).set(h).expect(200)).body.qr_token).toBeUndefined();
      expect((await http().get('/assets').set(h).expect(200)).body[0].qr_token).toBeUndefined();
    }
    for (const who of ['staff', 'admin'] as const) {
      const res = await http()
        .get(`/assets/${asset}`)
        .set(await as(people[who]))
        .expect(200);
      expect(typeof res.body.qr_token).toBe('string');
    }
  });
});
