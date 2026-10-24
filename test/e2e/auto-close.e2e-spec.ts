import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TicketStatus } from '../../src/domain/enums';
import { TicketWorkflowService } from '../../src/modules/tickets/ticket-workflow.service';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser, TicketInput } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;
const AFTER_HOURS = Number(process.env.AUTO_CLOSE_AFTER_HOURS ?? 72);
const OVERDUE = (AFTER_HOURS + 1) * HOUR;

// job ปิดอัตโนมัติ (DESIGN 6.6, 6.11) — ไม่มีใครยืนยันภายในกำหนด ระบบปิดให้ แต่ confirmed_by = NULL
// เทสสั่งรันผ่าน POST /admin/jobs/auto-close/run ซึ่งเรียก closeIfStillDue ตัวเดียวกับ cron
describe('auto-close job', () => {
  let app: INestApplication;
  let ds: DataSource;
  let workflow: TicketWorkflowService;
  let fx: {
    d1: string;
    room1: string;
    alice: string;
    bob: string;
    staff: string;
    admin: string;
    tech: string;
    ac1: string;
    wh1: string;
    lift1: string;
  };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ds = await openTestDb();
    workflow = app.get(TicketWorkflowService);
  });
  afterAll(async () => {
    await ds.destroy();
    await app.close();
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await truncateAll(ds);
    resetThrottle(app);
    const d1 = await makeBuilding(ds, 'J1');
    const room1 = await makeRoom(ds, d1, '401');
    const room2 = await makeRoom(ds, d1, '402');
    fx = {
      d1,
      room1,
      alice: await makeUser(ds, { roomId: room1 }),
      bob: await makeUser(ds, { roomId: room2 }),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
      tech: await makeUser(ds, { role: 'technician' }),
      ac1: await makeAsset(ds, d1, room1, 'AC-401'),
      wh1: await makeAsset(ds, d1, room1, 'WH-401'),
      lift1: await makeAsset(ds, d1, null, 'LIFT-01'),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  const run = async (userId = fx.admin) =>
    http()
      .post('/admin/jobs/auto-close/run')
      .set(await as(userId));

  // ใบที่ช่างกดซ่อมเสร็จเมื่อ age ที่แล้ว — ค่าเริ่มต้นเลยกำหนดมา 1 ชั่วโมง
  const resolved = async (asset: string, age = OVERDUE, over: Partial<TicketInput> = {}) => {
    const [a]: { room_id: string | null }[] = await ds.query(`SELECT room_id FROM assets WHERE id = $1`, [asset]);
    return makeTicket(ds, {
      assetId: asset,
      reporterId: fx.alice,
      scope: a.room_id ? 'room' : 'common_area',
      roomId: a.room_id,
      status: 'resolved',
      assignedTo: fx.tech,
      permissionToEnter: a.room_id !== null,
      resolvedAt: new Date(Date.now() - age),
      ...over,
    });
  };
  const row = async (ticketId: string): Promise<Record<string, unknown>> =>
    (await ds.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]))[0];
  const closeLogs = async (ticketId: string) =>
    ds.query(
      `SELECT actor_id, note FROM ticket_status_logs WHERE ticket_id = $1 AND from_status = 'resolved' AND to_status = 'closed'`,
      [ticketId],
    );

  describe('เงื่อนไขของ job', () => {
    // @parity test_closes_ticket_nobody_confirmed — P*: + close_reason = auto_closed
    it('ใบที่ไม่มีใครยืนยันจนเลยกำหนด → closed · confirmed_by = NULL · close_reason = auto_closed', async () => {
      const t = await resolved(fx.ac1);
      const res = await run();
      expect(res.status).toBe(200);
      expect(res.body.closed_count).toBe(1);
      expect(await row(t)).toMatchObject({ status: 'closed', confirmed_by: null, close_reason: 'auto_closed' });
      expect((await row(t)).closed_at).not.toBeNull();
    });

    // @parity test_auto_close_writes_a_log_with_no_actor
    it('เขียน status log resolved → closed โดยไม่มีผู้กด (actor = NULL = ระบบ) และบอกกำหนดเวลาใน note', async () => {
      const t = await resolved(fx.ac1);
      await run();
      const [log] = await closeLogs(t);
      expect(log.actor_id).toBeNull();
      expect(log.note).toContain(String(AFTER_HOURS));
    });

    // @parity test_does_not_touch_tickets_inside_the_grace_period
    it('ยังไม่ครบกำหนด (ขาดอีก 1 ชั่วโมง) → ไม่แตะ', async () => {
      const t = await resolved(fx.ac1, (AFTER_HOURS - 1) * HOUR);
      expect((await run()).body.closed_count).toBe(0);
      expect(await row(t)).toMatchObject({ status: 'resolved' });
    });

    // @parity test_only_resolved_tickets_are_closed ×3 — P*: new → open
    it.each<TicketStatus>(['open', 'assigned', 'in_progress'])(
      'ใบ %s ไม่ถูกปิดแม้จะค้างมา 30 วัน — ยังไม่มีใครบอกว่าซ่อมเสร็จ',
      async (status) => {
        const t = await makeTicket(ds, {
          assetId: fx.lift1,
          reporterId: fx.alice,
          status,
          ...(status === 'open' ? {} : { assignedTo: fx.tech }),
        });
        await ds.query(`UPDATE tickets SET created_at = now() - interval '30 days' WHERE id = $1`, [t]);
        expect((await run()).body.closed_count).toBe(0);
        expect(await row(t)).toMatchObject({ status });
      },
    );

    // @parity test_skips_soft_deleted_tickets
    it('ใบที่ถูกลบแบบ soft → ไม่แตะ', async () => {
      const t = await resolved(fx.ac1, OVERDUE, { deletedAt: new Date() });
      expect((await run()).body.closed_count).toBe(0);
      expect(await row(t)).toMatchObject({ status: 'resolved' });
    });

    // @parity test_running_twice_closes_nothing_the_second_time
    it('รันซ้ำทันที รอบสองไม่ปิดอะไรเพิ่ม', async () => {
      await resolved(fx.ac1);
      expect((await run()).body.closed_count).toBe(1);
      expect((await run()).body.closed_count).toBe(0);
    });

    // @parity test_user_confirmed_tickets_keep_their_confirmer
    it('ใบที่ผู้พักยืนยันเองไม่ถูก job แตะ และ confirmed_by ยังเป็นคนนั้น', async () => {
      const t = await resolved(fx.ac1);
      await http()
        .post(`/tickets/${t}/confirm`)
        .set(await as(fx.alice))
        .expect(200);
      expect((await run()).body.closed_count).toBe(0);
      expect(await row(t)).toMatchObject({ confirmed_by: fx.alice, close_reason: 'user_confirmed' });
    });

    // @parity test_auto_closed_ticket_frees_the_asset
    it('ปิดแล้วแจ้งครุภัณฑ์ชิ้นเดิมใหม่ได้', async () => {
      await resolved(fx.ac1);
      await run();
      const res = await http()
        .post('/tickets')
        .set(await as(fx.alice))
        .send({ items: [{ asset_id: fx.ac1, title: 'เสียอีกแล้ว' }] });
      expect(res.status).toBe(201);
    });

    // @parity test_closes_several_tickets_in_one_run
    it('รอบเดียวปิดหลายใบ — เฉพาะใบที่เลยกำหนด', async () => {
      await resolved(fx.ac1);
      await resolved(fx.lift1);
      await resolved(fx.wh1, HOUR);
      expect((await run()).body.closed_count).toBe(2);
    });

    // @parity test_ignores_resolved_at_when_status_moved_on
    it('resolved_at ค้างอยู่แต่สถานะเดินต่อไปแล้ว → ไม่ปิด', async () => {
      const t = await resolved(fx.ac1, OVERDUE, { status: 'in_progress' });
      expect((await run()).body.closed_count).toBe(0);
      expect(await row(t)).toMatchObject({ status: 'in_progress', closed_at: null });
    });

    // ใหม่ (DESIGN 3.4): ใบส่วนกลางที่มีคนแย้งว่ายังไม่หาย — Staff ต้องตัดสินเอง
    it('ใบส่วนกลางที่มีคนแย้ง (disputed_at) → job ข้าม', async () => {
      const t = await resolved(fx.lift1, OVERDUE, { disputedAt: new Date(Date.now() - HOUR) });
      expect((await run()).body.closed_count).toBe(0);
      expect(await row(t)).toMatchObject({ status: 'resolved' });
    });
  });

  describe('เช็คซ้ำหลัง lock (DESIGN 6.11)', () => {
    // แทรกการเปลี่ยนแปลงระหว่าง "เลือกรายการ" กับ "ลงมือปิด" — จำลองสิ่งที่เกิดได้จริงเมื่อรายการยาว
    const between = (change: () => Promise<void>) => {
      const original = workflow.dueForAutoClose.bind(workflow);
      jest.spyOn(workflow, 'dueForAutoClose').mockImplementationOnce(async (hours: number) => {
        const ids = await original(hours);
        await change();
        return ids;
      });
    };

    // mutation check: ตัดการเช็คซ้ำหลัง lock ออกแล้วสองเทสนี้ต้องแดง
    it('ถูก reopen แล้ว resolve รอบใหม่ระหว่างรอบ → ไม่ปิด (เวลาเริ่มนับใหม่แล้ว)', async () => {
      const t = await resolved(fx.ac1);
      between(async () => {
        await http()
          .post(`/tickets/${t}/reopen`)
          .set(await as(fx.alice))
          .send({ note: 'ยังไม่หาย' })
          .expect(200);
        await http()
          .post(`/tickets/${t}/status`)
          .set(await as(fx.tech))
          .send({ to: 'in_progress' })
          .expect(200);
        await http()
          .post(`/tickets/${t}/status`)
          .set(await as(fx.tech))
          .send({ to: 'resolved' })
          .expect(200);
      });
      const res = await run();
      expect(res.body.closed_count).toBe(0);
      expect(await row(t)).toMatchObject({ status: 'resolved', reopen_count: 1 });
    });

    it('มีคนกดเจอปัญหาเดียวกันระหว่างรอบ (disputed_at ถูกตั้ง) → ไม่ปิด', async () => {
      const t = await resolved(fx.lift1);
      between(async () => {
        await http()
          .post(`/tickets/${t}/same-issue`)
          .set(await as(fx.bob))
          .expect(200);
      });
      expect((await run()).body.closed_count).toBe(0);
      expect((await row(t)).disputed_at).not.toBeNull();
      expect(await row(t)).toMatchObject({ status: 'resolved' });
    });

    it('ใบหนึ่ง error → log แล้วไปต่อ ใบอื่นยังถูกปิด', async () => {
      const broken = await resolved(fx.ac1);
      const fine = await resolved(fx.lift1);
      // ทำให้ UPDATE ของใบเดียวล้มจริงที่ DB — ไม่ใช่ mock ของโค้ดที่กำลังทดสอบ
      await ds.query(`
        CREATE FUNCTION test_break_one_ticket() RETURNS trigger AS $$
        BEGIN
          IF NEW.id = '${broken}' THEN RAISE EXCEPTION 'จำลองใบที่ปิดไม่ได้'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await ds.query(
        `CREATE TRIGGER trg_test_break BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION test_break_one_ticket()`,
      );
      try {
        const res = await run();
        expect(res.status).toBe(200);
        expect(res.body.tickets.map((x: { id: string }) => x.id)).toEqual([fine]);
        expect(await row(fine)).toMatchObject({ status: 'closed' });
        expect(await row(broken)).toMatchObject({ status: 'resolved' });
        expect(await closeLogs(broken)).toEqual([]);
      } finally {
        await ds.query(`DROP TRIGGER trg_test_break ON tickets`);
        await ds.query(`DROP FUNCTION test_break_one_ticket()`);
      }
    });

    // DESIGN 10 หมวด concurrency — สองทางเข้าสู่ closed ต้องเข้าคิวที่ lock แถวเดียวกัน
    it('ผู้พักกด confirm พร้อมกับ job → log resolved → closed มีแถวเดียวทุกใบ', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) ids.push(await resolved(await makeAsset(ds, fx.d1, fx.room1, `C-${i}`)));
      const h = await as(fx.alice);
      await Promise.all([run(), ...ids.map((id) => http().post(`/tickets/${id}/confirm`).set(h))]);
      for (const id of ids) {
        expect(await closeLogs(id)).toHaveLength(1);
        expect(await row(id)).toMatchObject({ status: 'closed' });
      }
    });
  });

  describe('POST /admin/jobs/auto-close/run', () => {
    // @parity test_admin_can_trigger_the_job — P*: endpoint ใหม่ไม่มี dry_run
    it('admin สั่งรันได้ — ผลบอกใบที่ปิดพร้อมหลักฐานว่าระบบปิด', async () => {
      const t = await resolved(fx.ac1);
      const res = await run(fx.admin);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        closed_count: 1,
        tickets: [
          {
            id: t,
            ticket_no: expect.any(String),
            status: 'closed',
            confirmed_by: null,
            close_reason: 'auto_closed',
          },
        ],
      });
    });

    // @parity test_only_admin_can_trigger_the_job ×3
    it.each(['staff', 'tech', 'alice'] as const)('%s สั่งรันไม่ได้ → 403 และไม่มีใบถูกปิด', async (who) => {
      const t = await resolved(fx.ac1);
      expect((await run(fx[who])).status).toBe(403);
      expect(await row(t)).toMatchObject({ status: 'resolved' });
    });

    // @parity test_job_requires_login
    it('ต้อง login', async () => {
      expect((await http().post('/admin/jobs/auto-close/run')).status).toBe(401);
    });

    it('ไม่มีพารามิเตอร์ที่ข้ามเงื่อนไขเวลาได้ (ของเดิมมี dry_run — ตัดทิ้ง)', async () => {
      const t = await resolved(fx.ac1, HOUR);
      const res = await http()
        .post('/admin/jobs/auto-close/run?after_hours=0')
        .set(await as(fx.admin));
      expect(res.body.closed_count).toBe(0);
      expect(await row(t)).toMatchObject({ status: 'resolved' });
    });
  });

  // เส้นทางเต็มผ่าน API จริงทุกขั้น: dispute ทำให้ job ข้าม → Staff ส่งกลับ → ซ่อมใหม่ → ครบกำหนดรอบใหม่ → ปิดได้
  it('เส้นทาง dispute → reopen → resolve → ครบกำหนด → ถูกปิดอัตโนมัติได้', async () => {
    const t = await resolved(fx.lift1);
    const post = async (userId: string, path: string, body: object = {}) =>
      http()
        .post(`/tickets/${t}${path}`)
        .set(await as(userId))
        .send(body)
        .expect(200);

    await post(fx.bob, '/same-issue');
    expect((await run()).body.closed_count).toBe(0);

    await post(fx.staff, '/reopen', { note: 'มีคนแย้งว่ายังค้าง' });
    expect((await row(t)).disputed_at).toBeNull();
    await post(fx.tech, '/status', { to: 'in_progress' });
    await post(fx.tech, '/status', { to: 'resolved' });
    expect((await run()).body.closed_count).toBe(0); // รอบใหม่เพิ่งเริ่ม ยังไม่ครบกำหนด

    await ds.query(`UPDATE tickets SET resolved_at = $2 WHERE id = $1`, [t, new Date(Date.now() - OVERDUE)]);
    expect((await run()).body.closed_count).toBe(1);
    expect(await row(t)).toMatchObject({ status: 'closed', close_reason: 'auto_closed', reopen_count: 1 });
  });
});
