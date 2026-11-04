import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;

// GET/POST /tickets/:id/comments (สัปดาห์ 6, DESIGN 4.2, 4.3, 7)
// ความเห็นภายใน (is_internal) นักศึกษาไม่เห็นและเขียนไม่ได้ — TicketPolicy.canSeeInternal ตัวเดียวทั้งอ่านและเขียน
// mutation check:
//   ไม่กรอง is_internal ตอนอ่าน → เทส "นักศึกษาไม่เห็นความเห็นภายใน" แดง
//   ไม่เช็ค is_internal ของนักศึกษาตอนเขียน → เทส "นักศึกษาส่ง is_internal" แดง
//   comment ใช้แค่ canSee แทน ownership → เทส "ผู้แจ้งที่ย้ายห้อง" แดง
describe('comments', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: {
    d1: string;
    room1: string;
    alice: string;
    bob: string;
    otherBuilding: string;
    tech: string;
    tech2: string;
    staff: string;
    roomTicket: string;
    commonTicket: string;
  };

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
    const d1 = await makeBuilding(ds, 'C1');
    const d2 = await makeBuilding(ds, 'C2');
    const room1 = await makeRoom(ds, d1, '101');
    const room2 = await makeRoom(ds, d1, '102');
    const farRoom = await makeRoom(ds, d2, '201');
    const alice = await makeUser(ds, { roomId: room1 });
    const tech = await makeUser(ds, { role: 'technician' });
    fx = {
      d1,
      room1,
      alice,
      bob: await makeUser(ds, { roomId: room2 }),
      otherBuilding: await makeUser(ds, { roomId: farRoom }),
      tech,
      tech2: await makeUser(ds, { role: 'technician' }),
      staff: await makeUser(ds, { role: 'staff' }),
      roomTicket: await makeTicket(ds, {
        assetId: await makeAsset(ds, d1, room1, 'AC'),
        reporterId: alice,
        scope: 'room',
        roomId: room1,
        status: 'assigned',
        assignedTo: tech,
      }),
      commonTicket: await makeTicket(ds, { assetId: await makeAsset(ds, d1, null, 'LIFT'), reporterId: alice }),
    };
  });

  const http = () => request(app.getHttpServer());
  const post = async (userId: string, ticketId: string, body: object) =>
    http()
      .post(`/tickets/${ticketId}/comments`)
      .set(await bearer(app, userId))
      .send(body);
  const list = async (userId: string, ticketId: string) =>
    http()
      .get(`/tickets/${ticketId}/comments`)
      .set(await bearer(app, userId));
  const detail = async (userId: string, ticketId: string) =>
    http()
      .get(`/tickets/${ticketId}`)
      .set(await bearer(app, userId));
  const count = async () => (await ds.query(`SELECT count(*)::int AS n FROM ticket_comments`))[0].n as number;
  const bodies = (res: request.Response) => (res.body as { body: string }[]).map((c) => c.body);

  it('ผู้พักเขียนได้ · ทุกคนที่เห็นใบอ่านได้ เรียงเก่าไปใหม่ พร้อมชื่อและบทบาทผู้เขียน', async () => {
    const first = await post(fx.alice, fx.roomTicket, { body: '  แอร์มีน้ำหยด  ' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      body: 'แอร์มีน้ำหยด',
      is_internal: false,
      author: { id: fx.alice, role: 'student' },
    });
    expect((await post(fx.tech, fx.roomTicket, { body: 'จะเข้าไปดูพรุ่งนี้ 10 โมง' })).status).toBe(201);

    for (const who of [fx.alice, fx.tech, fx.staff]) {
      const res = await list(who, fx.roomTicket);
      expect(res.status).toBe(200);
      expect(bodies(res)).toEqual(['แอร์มีน้ำหยด', 'จะเข้าไปดูพรุ่งนี้ 10 โมง']);
    }
  });

  it('นักศึกษาไม่เห็นความเห็นภายใน · ช่างเจ้าของงานและ Staff เห็น', async () => {
    const internal = await post(fx.staff, fx.roomTicket, { body: 'อะไหล่ราคา 1,200 บาท', is_internal: true });
    expect(internal.status).toBe(201);
    expect((await post(fx.staff, fx.roomTicket, { body: 'รับเรื่องแล้วครับ' })).status).toBe(201);

    expect(bodies(await list(fx.alice, fx.roomTicket))).toEqual(['รับเรื่องแล้วครับ']);
    for (const who of [fx.tech, fx.staff]) {
      const res = await list(who, fx.roomTicket);
      expect((res.body as { is_internal: boolean }[]).map((c) => c.is_internal)).toEqual([true, false]);
    }
  });

  it('นักศึกษาส่ง is_internal = true → 403 และไม่มีอะไรถูกบันทึก', async () => {
    const res = await post(fx.alice, fx.roomTicket, { body: 'ลองเขียนภายใน', is_internal: true });
    expect(res.status).toBe(403);
    expect(await count()).toBe(0);
  });

  it('มองไม่เห็นใบ → 404 ทั้งอ่านและเขียน (นักศึกษาห้องอื่น, ช่างที่ไม่ได้รับงาน)', async () => {
    for (const who of [fx.bob, fx.tech2]) {
      expect((await list(who, fx.roomTicket)).status).toBe(404);
      expect((await post(who, fx.roomTicket, { body: 'สวัสดี' })).status).toBe(404);
    }
    expect(await count()).toBe(0);
  });

  it('ใบส่วนกลาง: นักศึกษาทุกอาคารเขียนได้ (ไม่มีเงื่อนไขอาคารเดียวกัน)', async () => {
    expect((await post(fx.otherBuilding, fx.commonTicket, { body: 'ลิฟต์อาคารนี้ก็ค้าง' })).status).toBe(201);
  });

  it('ผู้แจ้งที่ย้ายห้องแล้วยังอ่านได้ แต่เขียนไม่ได้ (403) และไม่มีปุ่ม comment', async () => {
    await ds.query(`UPDATE users SET room_id = NULL WHERE id = $1`, [fx.alice]);
    expect((await list(fx.alice, fx.roomTicket)).status).toBe(200);
    expect((await post(fx.alice, fx.roomTicket, { body: 'ยังไม่ได้ซ่อม' })).status).toBe(403);
    expect((await detail(fx.alice, fx.roomTicket)).body.actions).not.toContain('comment');
  });

  it('ใบที่จบแล้วยังเขียนได้ (ไม่มี 409) และปุ่มที่เหลือคือ comment', async () => {
    const closed = await makeTicket(ds, {
      assetId: await makeAsset(ds, fx.d1, fx.room1, 'BED'),
      reporterId: fx.alice,
      scope: 'room',
      roomId: fx.room1,
      status: 'closed',
      assignedTo: fx.tech,
      resolvedAt: new Date(Date.now() - 2 * HOUR),
      closedAt: new Date(Date.now() - HOUR),
      closeReason: 'user_confirmed',
    });
    expect((await post(fx.alice, closed, { body: 'ขอบคุณครับ' })).status).toBe(201);
    expect((await detail(fx.alice, closed)).body.actions).toEqual(['comment']);
  });

  it.each([{ body: '   ' }, { body: 'ก'.repeat(2001) }, {}, { body: 'x', is_internal: 'yes' }])(
    'body ไม่ถูกต้อง %p → 400',
    async (body) => {
      expect((await post(fx.staff, fx.roomTicket, body)).status).toBe(400);
    },
  );

  it('ความเห็นที่ถูกลบแบบ soft ไม่ถูกส่งออกไป', async () => {
    const res = await post(fx.staff, fx.roomTicket, { body: 'พิมพ์ผิด' });
    await ds.query(`UPDATE ticket_comments SET deleted_at = now() WHERE id = $1`, [res.body.id]);
    expect((await list(fx.staff, fx.roomTicket)).body).toEqual([]);
  });
});
