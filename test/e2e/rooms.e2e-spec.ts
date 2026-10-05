import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

describe('buildings + rooms', () => {
  let app: INestApplication;
  let ds: DataSource;
  let d1: string;
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
    people = {
      student: await makeUser(ds),
      tech: await makeUser(ds, { role: 'technician' }),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  const roomBody = (over: object = {}) => ({ building_id: d1, room_no: '201', floor: 2, ...over });

  describe('rooms', () => {
    // @parity test_anyone_logged_in_can_read_rooms — ตัด /rooms/by-code ออก (schema ใหม่ไม่มี room_code)
    it.each(['student', 'tech', 'staff', 'admin'] as const)('%s อ่านรายการและรายละเอียดห้องได้', async (who) => {
      const room = await makeRoom(ds, d1, '401');
      const h = await as(people[who]);
      const list = await http().get('/rooms').set(h).expect(200);
      expect(list.body).toEqual([{ id: room, building_id: d1, room_no: '401', floor: 3, capacity: 2 }]);
      await http().get(`/rooms/${room}`).set(h).expect(200);
      await http().get('/rooms/00000000-0000-4000-8000-000000000000').set(h).expect(404);
      await http().get('/rooms/abc').set(h).expect(400);
    });

    it('กรองตามอาคารได้', async () => {
      const d2 = await makeBuilding(ds, 'D2');
      await makeRoom(ds, d1, '401');
      const other = await makeRoom(ds, d2, '401');
      const res = await http()
        .get('/rooms')
        .set(await as(people.student))
        .query({ building_id: d2 })
        .expect(200);
      expect((res.body as { id: string }[]).map((r) => r.id)).toEqual([other]);
    });

    // @parity test_rooms_require_login
    it('ต้อง login', async () => {
      await http().get('/rooms').expect(401);
      await http().post('/rooms').send(roomBody()).expect(401);
    });

    // @parity test_only_managers_create_rooms ×2
    it.each(['student', 'tech'] as const)('%s สร้าง / แก้ห้องไม่ได้ → 403', async (who) => {
      const room = await makeRoom(ds, d1, '401');
      const h = await as(people[who]);
      await http().post('/rooms').set(h).send(roomBody()).expect(403);
      await http().put(`/rooms/${room}`).set(h).send(roomBody()).expect(403);
      await http().patch(`/rooms/${room}`).set(h).send({ capacity: 3 }).expect(403);
    });

    // @parity test_staff_creates_room — P*: ส่ง building_id แทนชื่ออาคาร
    it('staff สร้างห้องได้ — capacity เริ่มต้น 2', async () => {
      const res = await http()
        .post('/rooms')
        .set(await as(people.staff))
        .send(roomBody())
        .expect(201);
      expect(res.body).toMatchObject({ building_id: d1, room_no: '201', floor: 2, capacity: 2 });
    });

    // @parity test_duplicate_room_is_409 — P*: uq_rooms_no (building_id, room_no)
    it('เลขห้องซ้ำในอาคารเดียวกัน → 409 · อาคารอื่นใช้เลขเดียวกันได้', async () => {
      const h = await as(people.staff);
      const first = await http().post('/rooms').set(h).send(roomBody()).expect(201);
      const dup = await http()
        .post('/rooms')
        .set(h)
        .send(roomBody({ floor: 9 }))
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'UNIQUE_VIOLATION', details: { constraint: 'uq_rooms_no' } });

      const d2 = await makeBuilding(ds, 'D2');
      await http()
        .post('/rooms')
        .set(h)
        .send(roomBody({ building_id: d2 }))
        .expect(201);

      // ลบแบบ soft แล้วเลขห้องเดิมสร้างใหม่ได้
      await http()
        .delete(`/rooms/${first.body.id}`)
        .set(await as(people.admin))
        .expect(204);
      await http().post('/rooms').set(h).send(roomBody()).expect(201);
    });

    // @parity test_room_validation
    it.each([
      roomBody({ floor: 0 }),
      roomBody({ floor: 1.5 }),
      roomBody({ capacity: 0 }),
      roomBody({ room_no: '' }),
      roomBody({ building_id: 'abc' }),
      { room_no: 'X' },
      roomBody({ extra: 1 }),
    ])('ข้อมูลผิด %p → 400', async (body) => {
      const res = await http()
        .post('/rooms')
        .set(await as(people.staff))
        .send(body)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('อาคารที่ไม่มีอยู่ หรือถูกลบแบบ soft → 400', async () => {
      const gone = await makeBuilding(ds, 'OLD');
      await ds.query(`UPDATE buildings SET deleted_at = now() WHERE id = $1`, [gone]);
      const h = await as(people.staff);
      for (const building_id of ['00000000-0000-4000-8000-000000000000', gone]) {
        const res = await http().post('/rooms').set(h).send(roomBody({ building_id })).expect(400);
        expect(res.body.code).toBe('BUILDING_NOT_FOUND');
      }
    });

    // @parity test_put_replaces_whole_room_patch_changes_one_field
    it('PUT แทนที่ทั้งรายการ · PATCH แก้ฟิลด์เดียว', async () => {
      const room = await makeRoom(ds, d1, '401');
      const h = await as(people.staff);

      // PUT ต้องส่งครบ ขาดฟิลด์ → 400
      await http().put(`/rooms/${room}`).set(h).send({ capacity: 3 }).expect(400);

      const patched = await http().patch(`/rooms/${room}`).set(h).send({ capacity: 3 }).expect(200);
      expect(patched.body).toMatchObject({ capacity: 3, room_no: '401', floor: 3 });

      // PUT ไม่ส่ง capacity → กลับเป็นค่าเริ่มต้น เพราะแทนที่ทั้งรายการ
      const replaced = await http()
        .put(`/rooms/${room}`)
        .set(h)
        .send({ building_id: d1, room_no: '401', floor: 4 })
        .expect(200);
      expect(replaced.body).toMatchObject({ capacity: 2, floor: 4 });

      await http().patch(`/rooms/${room}`).set(h).send({ floor: null }).expect(400);
    });

    // แทนที่ test_moving_room_building_moves_its_assets: เดิมย้ายชื่ออาคารเป็น string
    // ใหม่ building เป็น FK แต่ assets.building_id ยังเก็บซ้ำไว้ (ครุภัณฑ์ส่วนกลางไม่มีห้อง) จึงยังต้องย้ายตาม
    it('ย้ายห้องไปอีกอาคาร ครุภัณฑ์ในห้องตามไปด้วย ส่วนกลางของอาคารเดิมไม่ถูกแตะ', async () => {
      const d9 = await makeBuilding(ds, 'D9');
      const room = await makeRoom(ds, d1, '401');
      const inRoom = await makeAsset(ds, d1, room);
      const common = await makeAsset(ds, d1);

      await http()
        .patch(`/rooms/${room}`)
        .set(await as(people.staff))
        .send({ building_id: d9 })
        .expect(200);

      const rows: { id: string; building_id: string }[] = await ds.query(`SELECT id, building_id FROM assets`);
      expect(rows.find((r) => r.id === inRoom)?.building_id).toBe(d9);
      expect(rows.find((r) => r.id === common)?.building_id).toBe(d1);
    });

    it('ลด capacity ต่ำกว่าจำนวนผู้พัก → 409', async () => {
      const room = await makeRoom(ds, d1, '401', 2);
      await makeUser(ds, { roomId: room });
      await makeUser(ds, { roomId: room });
      const res = await http()
        .patch(`/rooms/${room}`)
        .set(await as(people.staff))
        .send({ capacity: 1 })
        .expect(409);
      expect(res.body.code).toBe('ROOM_OVER_CAPACITY');
    });

    // @parity test_delete_room_in_use_is_409
    it('ลบห้องที่ยังมีผู้พัก → 409', async () => {
      const room = await makeRoom(ds, d1, '401');
      await makeUser(ds, { roomId: room });
      const res = await http()
        .delete(`/rooms/${room}`)
        .set(await as(people.admin))
        .expect(409);
      expect(res.body).toMatchObject({ code: 'ROOM_IN_USE', details: { occupants: 1 } });
      const [row]: { deleted_at: Date | null }[] = await ds.query(`SELECT deleted_at FROM rooms WHERE id = $1`, [room]);
      expect(row.deleted_at).toBeNull();
    });

    it('ผู้พักที่ถูกลบแบบ soft ไปแล้วไม่กันการลบห้อง', async () => {
      const room = await makeRoom(ds, d1, '401');
      const old = await makeUser(ds, { roomId: room });
      await ds.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [old]);
      await http()
        .delete(`/rooms/${room}`)
        .set(await as(people.admin))
        .expect(204);
    });

    // @parity test_delete_room_with_assets_is_409
    it('ลบห้องที่ยังมีครุภัณฑ์ → 409', async () => {
      const room = await makeRoom(ds, d1, '401');
      await makeAsset(ds, d1, room);
      const res = await http()
        .delete(`/rooms/${room}`)
        .set(await as(people.admin))
        .expect(409);
      expect(res.body.code).toBe('ROOM_HAS_ASSETS');
    });

    // @parity test_delete_empty_room_admin_only
    it('ลบห้องว่างได้เฉพาะ admin — ลบแบบ soft', async () => {
      const room = await makeRoom(ds, d1, '401');
      await http()
        .delete(`/rooms/${room}`)
        .set(await as(people.staff))
        .expect(403);
      await http()
        .delete(`/rooms/${room}`)
        .set(await as(people.admin))
        .expect(204);
      await http()
        .get(`/rooms/${room}`)
        .set(await as(people.admin))
        .expect(404);
      const [row]: { deleted_at: Date | null }[] = await ds.query(`SELECT deleted_at FROM rooms WHERE id = $1`, [room]);
      expect(row.deleted_at).not.toBeNull();
      await http()
        .delete(`/rooms/${room}`)
        .set(await as(people.admin))
        .expect(404);
    });
  });

  describe('buildings', () => {
    it('ทุก role อ่านได้ · ต้อง login', async () => {
      await http().get('/buildings').expect(401);
      const res = await http()
        .get('/buildings')
        .set(await as(people.student))
        .expect(200);
      expect(res.body).toEqual([{ id: d1, code: 'D1', name: 'อาคาร D1' }]);
      await http()
        .get(`/buildings/${d1}`)
        .set(await as(people.tech))
        .expect(200);
    });

    it.each(['student', 'tech'] as const)('%s เขียนไม่ได้ → 403', async (who) => {
      const h = await as(people[who]);
      await http().post('/buildings').set(h).send({ code: 'D2', name: 'x' }).expect(403);
      await http().patch(`/buildings/${d1}`).set(h).send({ name: 'x' }).expect(403);
      await http().delete(`/buildings/${d1}`).set(h).expect(403);
    });

    it('staff สร้าง / PUT / PATCH ได้ · รหัสซ้ำ → 409', async () => {
      const h = await as(people.staff);
      const created = await http().post('/buildings').set(h).send({ code: 'D2', name: 'หอ D2' }).expect(201);
      const dup = await http().post('/buildings').set(h).send({ code: 'D2', name: 'อีกตึก' }).expect(409);
      expect(dup.body.details).toEqual({ constraint: 'uq_buildings_code' });

      await http().put(`/buildings/${created.body.id}`).set(h).send({ name: 'ขาด code' }).expect(400);
      const put = await http().put(`/buildings/${created.body.id}`).set(h).send({ code: 'D3', name: 'หอ D3' });
      expect(put.body).toMatchObject({ code: 'D3', name: 'หอ D3' });
      const patched = await http().patch(`/buildings/${created.body.id}`).set(h).send({ name: 'ชื่อใหม่' }).expect(200);
      expect(patched.body).toMatchObject({ code: 'D3', name: 'ชื่อใหม่' });
      await http().patch(`/buildings/${created.body.id}`).set(h).send({ name: null }).expect(400);
    });

    it('ลบได้เฉพาะ admin และต้องไม่มีห้องหรือครุภัณฑ์เหลือ', async () => {
      const room = await makeRoom(ds, d1, '401');
      await http()
        .delete(`/buildings/${d1}`)
        .set(await as(people.staff))
        .expect(403);
      const h = await as(people.admin);
      const blocked = await http().delete(`/buildings/${d1}`).set(h).expect(409);
      expect(blocked.body).toMatchObject({ code: 'BUILDING_IN_USE', details: { rooms: 1, assets: 0 } });

      await http().delete(`/rooms/${room}`).set(h).expect(204);
      await http().delete(`/buildings/${d1}`).set(h).expect(204);
      await http().get(`/buildings/${d1}`).set(h).expect(404);
      await http().delete(`/buildings/${d1}`).set(h).expect(404);
    });
  });
});
