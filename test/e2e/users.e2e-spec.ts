import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OPEN_STATUSES } from '../../src/domain/status-rules';
import { UsersService } from '../../src/modules/users/users.service';
import { bearer, createTestApp, FakeMailService, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser, ticketNoOf } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

describe('users', () => {
  let app: INestApplication;
  let mail: FakeMailService;
  let ds: DataSource;
  let building: string;
  let people: { student: string; tech: string; staff: string; admin: string };

  beforeAll(async () => {
    ({ app, mail } = await createTestApp());
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
    building = await makeBuilding(ds, 'D1');
    people = {
      student: await makeUser(ds, { email: 'student.one@kmitl.ac.th' }),
      tech: await makeUser(ds, { email: 'tech.one@kmitl.ac.th', role: 'technician' }),
      staff: await makeUser(ds, { email: 'staff.one@kmitl.ac.th', role: 'staff' }),
      admin: await makeUser(ds, { email: 'admin.one@kmitl.ac.th', role: 'admin' }),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  const patch = async (actor: string, target: string, body: object) =>
    http()
      .patch(`/users/${target}`)
      .set(await as(actor))
      .send(body);
  const row = async (id: string) => {
    const [r]: { role: string; room_id: string | null; is_active: boolean; deleted_at: Date | null }[] = await ds.query(
      `SELECT role, room_id, is_active, deleted_at FROM users WHERE id = $1`,
      [id],
    );
    return r;
  };

  describe('POST /users', () => {
    // @parity test_admin_precreates_technician
    it('admin สร้างบัญชีช่างล่วงหน้า แล้ว login ครั้งแรกได้ role ที่ตั้งไว้', async () => {
      const res = await http()
        .post('/users')
        .set(await as(people.admin))
        .send({ email: 'Tech.Air@KMITL.ac.th', role: 'technician', full_name: 'ช่างแอร์' })
        .expect(201);
      expect(res.body).toMatchObject({
        email: 'tech.air@kmitl.ac.th',
        role: 'technician',
        full_name: 'ช่างแอร์',
        room_id: null,
        is_active: true,
      });

      await http().post('/auth/request-code').send({ email: 'tech.air@kmitl.ac.th' }).expect(202);
      const login = await http()
        .post('/auth/verify-code')
        .send({ email: 'tech.air@kmitl.ac.th', code: mail.last() })
        .expect(200);
      expect(login.body.user.role).toBe('technician');
      expect(login.body.user.id).toBe(res.body.id);
    });

    it('ไม่ระบุ role = student', async () => {
      const res = await http()
        .post('/users')
        .set(await as(people.admin))
        .send({ email: 'new@kmitl.ac.th' })
        .expect(201);
      expect(res.body.role).toBe('student');
    });

    // @parity test_staff_cannot_create_users
    it.each(['student', 'tech', 'staff'] as const)('%s สร้างผู้ใช้ไม่ได้ → 403', async (who) => {
      await http()
        .post('/users')
        .set(await as(people[who]))
        .send({ email: 'x@kmitl.ac.th', role: 'admin' })
        .expect(403);
    });

    // @parity test_create_user_duplicate_or_bad_email
    it('อีเมลซ้ำ → 409 (ไม่สนตัวพิมพ์) · อีเมลนอกมหาวิทยาลัย → 400', async () => {
      const h = await as(people.admin);
      await http().post('/users').set(h).send({ email: 'dup@kmitl.ac.th', role: 'staff' }).expect(201);
      const dup = await http().post('/users').set(h).send({ email: 'DUP@kmitl.ac.th', role: 'staff' }).expect(409);
      expect(dup.body).toMatchObject({ code: 'UNIQUE_VIOLATION', details: { constraint: 'uq_users_email' } });
      await http().post('/users').set(h).send({ email: 'x@gmail.com', role: 'staff' }).expect(400);
      await http().post('/users').set(h).send({ email: 'ok@kmitl.ac.th', role: 'boss' }).expect(400);
    });

    it('สร้างบัญชีอีเมลเดิมได้อีกครั้งหลังบัญชีเก่าถูกลบแบบ soft', async () => {
      const h = await as(people.admin);
      await http().delete(`/users/${people.student}`).set(h).expect(204);
      await http().post('/users').set(h).send({ email: 'student.one@kmitl.ac.th' }).expect(201);
    });

    it('ช่างผูกห้องไม่ได้ตั้งแต่ตอนสร้าง → 400', async () => {
      const room = await makeRoom(ds, building);
      const res = await http()
        .post('/users')
        .set(await as(people.admin))
        .send({ email: 't2@kmitl.ac.th', role: 'technician', room_id: room })
        .expect(400);
      expect(res.body.code).toBe('TECHNICIAN_CANNOT_HAVE_ROOM');
    });
  });

  describe('GET /users', () => {
    // @parity test_student_cannot_list_users
    it.each(['student', 'tech'] as const)('%s ดูรายชื่อไม่ได้ → 403', async (who) => {
      await http()
        .get('/users')
        .set(await as(people[who]))
        .expect(403);
    });

    // @parity test_list_users_filters — เรียกด้วย staff เหมือนของเดิม (staff ต้องหา id นักศึกษาเพื่อผูกห้อง)
    it('กรองตาม role / อีเมลบางส่วน / is_active / room_id', async () => {
      const h = await as(people.staff);
      const room = await makeRoom(ds, building);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [room, people.student]);
      await ds.query(`UPDATE users SET is_active = false WHERE id = $1`, [people.tech]);

      const ids = async (query: object): Promise<string[]> =>
        ((await http().get('/users').set(h).query(query).expect(200)).body as { id: string }[]).map((u) => u.id);

      expect(await ids({})).toHaveLength(4);
      expect(await ids({ role: 'technician' })).toEqual([people.tech]);
      expect(await ids({ email: 'ADMIN' })).toEqual([people.admin]);
      expect(await ids({ is_active: false })).toEqual([people.tech]);
      expect(await ids({ room_id: room })).toEqual([people.student]);
      // % ในคำค้นต้องเป็นตัวอักษรธรรมดา ไม่ใช่ wildcard
      expect(await ids({ email: '%' })).toEqual([]);
      await http().get('/users').set(h).query({ role: 'boss' }).expect(400);
    });

    it('ไม่แสดงผู้ใช้ที่ถูกลบแบบ soft', async () => {
      const h = await as(people.admin);
      await http().delete(`/users/${people.student}`).set(h).expect(204);
      const res = await http().get('/users').set(h).expect(200);
      expect((res.body as { id: string }[]).map((u) => u.id)).not.toContain(people.student);
    });
  });

  describe('PATCH /users/:id — สิทธิ์ต่อฟิลด์', () => {
    // @parity test_staff_assigns_room_then_student_can_report — ครึ่งแรก (ครึ่ง "แจ้งห้องได้" ทำพร้อม tickets สัปดาห์ 3)
    it('staff ผูกห้องให้นักศึกษาได้ และ /auth/me ของนักศึกษาเห็นห้องทันที', async () => {
      const room = await makeRoom(ds, building);
      const res = await patch(people.staff, people.student, { room_id: room });
      expect(res.status).toBe(200);
      expect(res.body.room_id).toBe(room);
      const me = await http()
        .get('/auth/me')
        .set(await as(people.student))
        .expect(200);
      expect(me.body.room_id).toBe(room);
    });

    it('staff ย้ายนักศึกษาออกจากห้องได้ (room_id: null)', async () => {
      const room = await makeRoom(ds, building);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [room, people.student]);
      const res = await patch(people.staff, people.student, { room_id: null });
      expect(res.status).toBe(200);
      expect(res.body.room_id).toBeNull();
    });

    // @parity test_staff_cannot_change_role_or_suspend
    it.each([{ role: 'admin' }, { is_active: false }, { full_name: 'x' }])('staff ส่ง %p → 403', async (body) => {
      const res = await patch(people.staff, people.student, body);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', details: { fields: Object.keys(body) } });
    });

    it('staff ส่ง room_id ปนกับฟิลด์ที่ไม่มีสิทธิ์ → 403 และไม่มีอะไรถูกแก้', async () => {
      const room = await makeRoom(ds, building);
      const res = await patch(people.staff, people.student, { room_id: room, role: 'staff' });
      expect(res.status).toBe(403);
      expect(await row(people.student)).toMatchObject({ role: 'student', room_id: null });
    });

    // @parity test_staff_cannot_promote_self
    it('staff เลื่อนขั้นตัวเองไม่ได้ → 403', async () => {
      expect((await patch(people.staff, people.staff, { role: 'admin' })).status).toBe(403);
    });

    it.each(['student', 'tech'] as const)('%s เรียก PATCH ไม่ได้เลย → 403', async (who) => {
      expect((await patch(people[who], people[who], { room_id: null })).status).toBe(403);
    });

    // @parity test_admin_changes_role_and_suspends — P*: token ของคนที่ถูกระงับได้ 401 (เดิม 403)
    it('admin เปลี่ยน role และระงับบัญชี — token เดิมของคนนั้นใช้ไม่ได้ทันที', async () => {
      const targetHeaders = await as(people.student);
      await http().get('/auth/me').set(targetHeaders).expect(200);

      const promoted = await patch(people.admin, people.student, { role: 'staff' });
      expect(promoted.body.role).toBe('staff');
      const suspended = await patch(people.admin, people.student, { is_active: false });
      expect(suspended.body.is_active).toBe(false);

      await http().get('/auth/me').set(targetHeaders).expect(401);
    });

    it('admin แก้ชื่อและผูกห้องได้ด้วย', async () => {
      const room = await makeRoom(ds, building);
      const res = await patch(people.admin, people.student, { full_name: 'สมชาย', room_id: room });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ full_name: 'สมชาย', room_id: room });
    });

    // @parity test_admin_cannot_lock_self_out
    it('admin ระงับ / ลด role / ลบบัญชีตัวเองไม่ได้ → 400', async () => {
      expect((await patch(people.admin, people.admin, { is_active: false })).status).toBe(400);
      const demote = await patch(people.admin, people.admin, { role: 'student' });
      expect(demote.status).toBe(400);
      expect(demote.body.code).toBe('CANNOT_CHANGE_SELF');
      await http()
        .delete(`/users/${people.admin}`)
        .set(await as(people.admin))
        .expect(400);
      expect(await row(people.admin)).toMatchObject({ role: 'admin', is_active: true, deleted_at: null });
    });

    it('ไม่พบผู้ใช้ → 404 · id ไม่ใช่ uuid → 400 · ฟิลด์ที่ไม่รู้จัก → 400', async () => {
      expect((await patch(people.admin, '00000000-0000-4000-8000-000000000000', { is_active: false })).status).toBe(
        404,
      );
      expect((await patch(people.admin, 'abc', { is_active: false })).status).toBe(400);
      expect((await patch(people.admin, people.student, { email: 'new@kmitl.ac.th' })).status).toBe(400);
      expect((await patch(people.admin, people.student, { role: null })).status).toBe(400);
    });
  });

  describe('ผูกห้อง', () => {
    // @parity test_full_room_is_409
    it('ห้องเต็ม → 409', async () => {
      const room = await makeRoom(ds, building, '401', 1);
      await makeUser(ds, { roomId: room });
      const res = await patch(people.staff, people.student, { room_id: room });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'ROOM_FULL', details: { capacity: 1, occupants: 1 } });
      expect((await row(people.student)).room_id).toBeNull();
    });

    it('คนที่ถูกลบแบบ soft ไม่นับเป็นผู้พัก', async () => {
      const room = await makeRoom(ds, building, '401', 1);
      const old = await makeUser(ds, { roomId: room });
      await ds.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [old]);
      expect((await patch(people.staff, people.student, { room_id: room })).status).toBe(200);
    });

    it('ส่ง room_id เดิมซ้ำในห้องที่เต็มพอดี ไม่นับตัวเองซ้ำ', async () => {
      const room = await makeRoom(ds, building, '401', 1);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [room, people.student]);
      expect((await patch(people.staff, people.student, { room_id: room })).status).toBe(200);
    });

    it('ห้องที่ไม่มีอยู่ หรือถูกลบแบบ soft → 400', async () => {
      const gone = await makeRoom(ds, building, '402');
      await ds.query(`UPDATE rooms SET deleted_at = now() WHERE id = $1`, [gone]);
      for (const roomId of ['00000000-0000-4000-8000-000000000000', gone]) {
        const res = await patch(people.staff, people.student, { room_id: roomId });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('ROOM_NOT_FOUND');
      }
    });

    it('ผูกสองคนเข้าห้องที่เหลือ 1 ที่พร้อมกัน → สำเร็จ 1 คน อีกคนได้ 409', async () => {
      const staffHeaders = await as(people.staff);
      // ทำหลายรอบ: race เกิดไม่ทุกครั้ง รอบเดียวอาจผ่านเพราะโชค
      for (let round = 0; round < 8; round++) {
        const room = await makeRoom(ds, building, `5${String(round).padStart(2, '0')}`, 2);
        await makeUser(ds, { roomId: room });
        const a = await makeUser(ds);
        const b = await makeUser(ds);

        const results = await Promise.all(
          [a, b].map((id) => http().patch(`/users/${id}`).set(staffHeaders).send({ room_id: room })),
        );
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        const [{ n }]: { n: number }[] = await ds.query(
          `SELECT count(*)::int AS n FROM users WHERE room_id = $1 AND deleted_at IS NULL`,
          [room],
        );
        expect(n).toBe(2);
      }
    });
  });

  describe('ช่างไม่ผูกห้อง (DESIGN 4.4)', () => {
    it('ผูกห้องให้ช่าง → 400', async () => {
      const room = await makeRoom(ds, building);
      const res = await patch(people.staff, people.tech, { room_id: room });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TECHNICIAN_CANNOT_HAVE_ROOM');
      expect((await row(people.tech)).room_id).toBeNull();
    });

    it('เปลี่ยนนักศึกษาที่มีห้องเป็นช่าง → 400 จนกว่าจะย้ายออกจากห้องในคำขอเดียวกัน', async () => {
      const room = await makeRoom(ds, building);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [room, people.student]);

      const res = await patch(people.admin, people.student, { role: 'technician' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TECHNICIAN_CANNOT_HAVE_ROOM');
      expect(await row(people.student)).toMatchObject({ role: 'student', room_id: room });

      const ok = await patch(people.admin, people.student, { role: 'technician', room_id: null });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ role: 'technician', room_id: null });
    });

    it('เปลี่ยนช่างเป็นนักศึกษาพร้อมผูกห้องในคำขอเดียวได้', async () => {
      const room = await makeRoom(ds, building);
      const res = await patch(people.admin, people.tech, { role: 'student', room_id: room });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: 'student', room_id: room });
    });

    // ปิดด่าน API ทิ้งแล้วยิงผ่าน HTTP จริง: CHECK ที่ DB ต้องยังจับได้ และต้องออกมาเป็น 400 ไม่ใช่ 500
    it('ถ้าด่านของ API หลุด ck_technician_no_room ยังกันไว้ และตอบ 400 ผ่าน DbErrorFilter', async () => {
      const guard = jest
        .spyOn(
          UsersService.prototype as unknown as { assertTechnicianHasNoRoom: () => void },
          'assertTechnicianHasNoRoom',
        )
        .mockImplementation(() => undefined);
      try {
        const room = await makeRoom(ds, building);
        const bind = await patch(people.staff, people.tech, { room_id: room });
        expect(bind.status).toBe(400);
        expect(bind.body).toMatchObject({ code: 'CHECK_VIOLATION', details: { constraint: 'ck_technician_no_room' } });

        const create = await http()
          .post('/users')
          .set(await as(people.admin))
          .send({ email: 't9@kmitl.ac.th', role: 'technician', room_id: room });
        expect(create.status).toBe(400);
        expect(create.body.details).toEqual({ constraint: 'ck_technician_no_room' });
      } finally {
        guard.mockRestore();
      }
      expect((await row(people.tech)).room_id).toBeNull();
    });
  });

  describe('ช่างที่ยังมีใบค้าง (DESIGN 4.4)', () => {
    const giveTicket = async (status: (typeof OPEN_STATUSES)[number] | 'closed' = 'assigned', deleted = false) => {
      const asset = await makeAsset(ds, building);
      const done = new Date();
      return makeTicket(ds, {
        assetId: asset,
        reporterId: people.student,
        assignedTo: people.tech,
        status,
        deletedAt: deleted ? done : null,
        ...(status === 'resolved' || status === 'closed' ? { resolvedAt: done } : {}),
        ...(status === 'closed' ? { closedAt: done, closeReason: 'staff_confirmed' } : {}),
      });
    };

    it('ระงับช่างที่มีใบค้าง → 409 พร้อมรายการ ticket_no และบัญชียังใช้งานได้', async () => {
      const t1 = await ticketNoOf(ds, await giveTicket('assigned'));
      const t2 = await ticketNoOf(ds, await giveTicket('in_progress'));

      const res = await patch(people.admin, people.tech, { is_active: false });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        statusCode: 409,
        code: 'TECHNICIAN_HAS_OPEN_TICKETS',
        details: { tickets: [t1, t2].sort() },
      });
      expect(await row(people.tech)).toMatchObject({ is_active: true, role: 'technician' });
    });

    it('เปลี่ยน role ของช่างที่มีใบค้าง → 409', async () => {
      await giveTicket();
      const res = await patch(people.admin, people.tech, { role: 'staff' });
      expect(res.status).toBe(409);
      expect((await row(people.tech)).role).toBe('technician');
    });

    it('ลบช่างที่มีใบค้าง → 409 และแถวไม่ถูกลบ', async () => {
      const no = await ticketNoOf(ds, await giveTicket());
      const res = await http()
        .delete(`/users/${people.tech}`)
        .set(await as(people.admin))
        .expect(409);
      expect(res.body.details.tickets).toEqual([no]);
      expect((await row(people.tech)).deleted_at).toBeNull();
    });

    // ทุกสถานะใน OPEN_STATUSES ที่มีผู้รับงานได้ — รวม resolved เพราะ reopen คืนงานให้ช่างคนเดิม
    it.each(OPEN_STATUSES.filter((s) => s !== 'open'))('ใบสถานะ %s นับเป็นใบค้าง', async (status) => {
      await giveTicket(status);
      expect((await patch(people.admin, people.tech, { is_active: false })).status).toBe(409);
    });

    it('ใบที่ปิดแล้วหรือถูกลบแบบ soft ไม่นับ → ระงับได้', async () => {
      await giveTicket('closed');
      await giveTicket('assigned', true);
      const res = await patch(people.admin, people.tech, { is_active: false });
      expect(res.status).toBe(200);
      expect(res.body.is_active).toBe(false);
    });

    it('ใบค้างของช่างคนอื่นไม่เกี่ยว', async () => {
      await giveTicket();
      const other = await makeUser(ds, { role: 'technician' });
      expect((await patch(people.admin, other, { is_active: false })).status).toBe(200);
    });

    it('แก้อย่างอื่นของช่างที่มีใบค้างได้ตามปกติ (ชื่อ / เปิดบัญชีกลับ)', async () => {
      await giveTicket();
      expect((await patch(people.admin, people.tech, { full_name: 'ช่างไฟ' })).status).toBe(200);
      expect((await patch(people.admin, people.tech, { is_active: true })).status).toBe(200);
    });

    it('ช่างที่ไม่มีใบค้าง ระงับ / เปลี่ยน role / ลบได้', async () => {
      expect((await patch(people.admin, people.tech, { is_active: false })).status).toBe(200);
      expect((await patch(people.admin, people.tech, { role: 'staff' })).status).toBe(200);
      const t2 = await makeUser(ds, { role: 'technician' });
      await http()
        .delete(`/users/${t2}`)
        .set(await as(people.admin))
        .expect(204);
    });
  });

  describe('DELETE /users/:id', () => {
    it('admin ลบแบบ soft → 204 แถวยังอยู่ token ของคนนั้นใช้ไม่ได้ และลบซ้ำได้ 404', async () => {
      const h = await as(people.admin);
      const targetHeaders = await as(people.student);
      await http().delete(`/users/${people.student}`).set(h).expect(204);

      expect((await row(people.student)).deleted_at).not.toBeNull();
      await http().get('/auth/me').set(targetHeaders).expect(401);
      await http().delete(`/users/${people.student}`).set(h).expect(404);
    });

    it.each(['student', 'tech', 'staff'] as const)('%s ลบไม่ได้ → 403', async (who) => {
      await http()
        .delete(`/users/${people.student}`)
        .set(await as(people[who]))
        .expect(403);
    });

    it('คนที่ถูกลบแล้วคืนที่ว่างให้ห้อง', async () => {
      const room = await makeRoom(ds, building, '401', 1);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [room, people.student]);
      await http()
        .delete(`/users/${people.student}`)
        .set(await as(people.admin))
        .expect(204);
      const other = await makeUser(ds);
      expect((await patch(people.staff, other, { room_id: room })).status).toBe(200);
    });
  });
});
