import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;

// เคสที่พึ่ง lock แถวใน transition() ทั้งหมด (CLAUDE.md กฎข้อ 4)
// mutation check: ลบ lock: { mode: 'pessimistic_write' } ออกจาก lockAndAuthorize แล้วไฟล์นี้ต้องแดง
describe('workflow — ชนกันพร้อมกัน', () => {
  let app: INestApplication;
  let ds: DataSource;
  let dorm: {
    d1: string;
    room1: string;
    alice: string;
    roommate: string;
    staff: string;
    staff2: string;
    admin: string;
    tech: string;
    tech2: string;
    ac1: string;
    lift1: string;
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
    const room1 = await makeRoom(ds, d1, '401');
    dorm = {
      d1,
      room1,
      alice: await makeUser(ds, { roomId: room1 }),
      roommate: await makeUser(ds, { roomId: room1 }),
      staff: await makeUser(ds, { role: 'staff' }),
      staff2: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
      tech: await makeUser(ds, { role: 'technician' }),
      tech2: await makeUser(ds, { role: 'technician' }),
      ac1: await makeAsset(ds, d1, room1, 'AC-401'),
      lift1: await makeAsset(ds, d1, null, 'LIFT-01'),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  // เปิด connection ของ pool ไว้ก่อน — ไม่งั้น request ที่ยิงพร้อมกันจะเข้าคิวที่การเปิด connection แทนที่จะชนกันจริง
  const warmPool = () => Promise.all(Array.from({ length: 10 }, () => ds.query(`SELECT pg_sleep(0.05)`)));

  const logsOf = async (ticketId: string, to: string): Promise<number> =>
    (
      await ds.query(`SELECT count(*)::int AS n FROM ticket_status_logs WHERE ticket_id = $1 AND to_status = $2`, [
        ticketId,
        to,
      ])
    )[0].n;
  const row = async (ticketId: string): Promise<Record<string, unknown>> =>
    (await ds.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]))[0];

  it('รูมเมทสองคนกด /confirm ใบเดียวกันพร้อมกัน → ปิดได้คนเดียว อีกคน 409 และ log มีแถวเดียว', async () => {
    const t = await makeTicket(ds, {
      assetId: dorm.ac1,
      reporterId: dorm.alice,
      scope: 'room',
      roomId: dorm.room1,
      status: 'resolved',
      assignedTo: dorm.tech,
      resolvedAt: new Date(Date.now() - HOUR),
    });
    await warmPool();
    const results = await Promise.all([
      http()
        .post(`/tickets/${t}/confirm`)
        .set(await as(dorm.alice)),
      http()
        .post(`/tickets/${t}/confirm`)
        .set(await as(dorm.roommate)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await logsOf(t, 'closed')).toBe(1);
    const after = await row(t);
    // คนที่ชนะต้องเป็นคนเดียวกับที่ถูกบันทึกไว้ว่ายืนยัน
    const winner = results.find((r) => r.status === 200)!.body as { confirmed_by: string };
    expect(after.confirmed_by).toBe(winner.confirmed_by);
    expect(after.close_reason).toBe('user_confirmed');
  });

  it('Staff สองคน /assign ใบเดียวกันพร้อมกันให้ช่างคนละคน → status log แถวเดียว และ assigned_to ตรงกับ audit แถวสุดท้าย', async () => {
    const t = await makeTicket(ds, { assetId: dorm.lift1, reporterId: dorm.alice, scope: 'common_area' });
    await warmPool();
    const results = await Promise.all([
      http()
        .post(`/tickets/${t}/assign`)
        .set(await as(dorm.staff))
        .send({ technician_id: dorm.tech }),
      http()
        .post(`/tickets/${t}/assign`)
        .set(await as(dorm.staff2))
        .send({ technician_id: dorm.tech2 }),
    ]);
    // ทั้งคู่สำเร็จได้ (คนที่สองกลายเป็นการเปลี่ยนตัวช่าง) แต่ขั้นต้องเปลี่ยนครั้งเดียว
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await logsOf(t, 'assigned')).toBe(1);
    const audit: { action: string; detail: { to: string } }[] = await ds.query(
      `SELECT action, detail FROM ticket_audit_logs WHERE ticket_id = $1 ORDER BY created_at, id`,
      [t],
    );
    expect(audit[0].action).toBe('assign');
    expect((await row(t)).assigned_to).toBe(audit.at(-1)!.detail.to);
  });

  it('ระงับช่างพร้อมกับมอบงานให้ช่างคนนั้น → สำเร็จได้อย่างมากทางเดียว', async () => {
    const t = await makeTicket(ds, { assetId: dorm.lift1, reporterId: dorm.alice, scope: 'common_area' });
    await warmPool();
    const [assign, suspend] = await Promise.all([
      http()
        .post(`/tickets/${t}/assign`)
        .set(await as(dorm.staff))
        .send({ technician_id: dorm.tech }),
      http()
        .patch(`/users/${dorm.tech}`)
        .set(await as(dorm.admin))
        .send({ is_active: false }),
    ]);
    expect([assign.status === 200, suspend.status === 200].filter(Boolean).length).toBeLessThanOrEqual(1);

    const [tech]: { is_active: boolean }[] = await ds.query(`SELECT is_active FROM users WHERE id = $1`, [dorm.tech]);
    const after = await row(t);
    // ไม่มีสถานะที่ "ช่างถูกระงับแต่ยังถือใบค้างอยู่"
    if (after.assigned_to === dorm.tech) expect(tech.is_active).toBe(true);
  });

  it('ช่างกด resolve พร้อมกับ Staff เปลี่ยนตัวช่าง → ผลสุดท้ายตรงกับ log ไม่มีสถานะค้างครึ่งทาง', async () => {
    const t = await makeTicket(ds, {
      assetId: dorm.lift1,
      reporterId: dorm.alice,
      scope: 'common_area',
      status: 'in_progress',
      assignedTo: dorm.tech,
    });
    await warmPool();
    const [resolve, reassign] = await Promise.all([
      http()
        .post(`/tickets/${t}/status`)
        .set(await as(dorm.tech))
        .send({ to: 'resolved' }),
      http()
        .post(`/tickets/${t}/assign`)
        .set(await as(dorm.staff))
        .send({ technician_id: dorm.tech2 }),
    ]);
    const after = await row(t);
    const logs: { from_status: string; to_status: string }[] = await ds.query(
      `SELECT from_status, to_status FROM ticket_status_logs WHERE ticket_id = $1 ORDER BY created_at, id`,
      [t],
    );
    // สถานะสุดท้ายต้องเป็นปลายทางของ log แถวสุดท้ายเสมอ — ไม่มีสถานะที่ไม่มี log รองรับ
    expect(after.status).toBe(logs.at(-1)!.to_status);
    // สองคำขอนี้ผ่านพร้อมกันไม่ได้: ใครได้ lock ก่อนก็ตัดอีกฝ่ายออก
    expect([resolve.status === 200, reassign.status === 200].filter(Boolean)).toHaveLength(1);

    if (resolve.status === 200) {
      // ช่างกดก่อน → Staff เปลี่ยนตัวช่างไม่ได้อีก ต้องไปทาง /reopen (409)
      expect(reassign.status).toBe(409);
      expect(after).toMatchObject({ status: 'resolved', assigned_to: dorm.tech });
      expect(after.resolved_at).not.toBeNull();
    } else {
      // Staff เปลี่ยนตัวช่างก่อน → ช่างคนเดิมมองไม่เห็นใบนี้แล้ว (404) และใบยังไม่ resolved
      expect(resolve.status).toBe(404);
      expect(after).toMatchObject({ status: 'assigned', assigned_to: dorm.tech2, resolved_at: null });
    }
  });
});
