import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TicketPriority, TicketStatus } from '../../src/domain/enums';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;
const SUMMARY = '/reports/sla-summary';
const STAGES = '/reports/stage-durations';
const TECHS = '/reports/technicians';

// รายงาน (DESIGN 9) — เทสวางใบพร้อม status log ที่เวลาเดินต่อกันจริงลง DB ตรง ๆ
// (ของเดิมเดินผ่าน API แล้วย้อนเวลาใน log ทีหลัง ผลเหมือนกันแต่คุมเวลาได้แม่นกว่า)
describe('reports', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: {
    d1: string;
    d2: string;
    room1: string;
    room2: string;
    alice: string;
    bob: string;
    staff: string;
    admin: string;
    tech: string;
    tech2: string;
    ac1: string;
    wh1: string;
    lift1: string;
    lift2: string;
  };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
    await app.close();
  });

  const assetOf = async (building: string, room: string | null, code: string, category: string) => {
    const id = await makeAsset(ds, building, room, code);
    await ds.query(`UPDATE assets SET category = $2 WHERE id = $1`, [id, category]);
    return id;
  };

  beforeEach(async () => {
    await truncateAll(ds);
    resetThrottle(app);
    const d1 = await makeBuilding(ds, 'D1');
    const d2 = await makeBuilding(ds, 'D2');
    const room1 = await makeRoom(ds, d1, '401');
    const room2 = await makeRoom(ds, d2, '501');
    fx = {
      d1,
      d2,
      room1,
      room2,
      alice: await makeUser(ds, { roomId: room1 }),
      bob: await makeUser(ds, { roomId: room2 }),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
      tech: await makeUser(ds, { role: 'technician' }),
      tech2: await makeUser(ds, { role: 'technician' }),
      ac1: await assetOf(d1, room1, 'AC-D1-401', 'aircon'),
      wh1: await assetOf(d1, room1, 'WH-D1-401', 'electrical'),
      lift1: await assetOf(d1, null, 'LIFT-D1-01', 'elevator'),
      lift2: await assetOf(d2, null, 'LIFT-D2-01', 'elevator'),
    };
    await ds.query(`UPDATE users SET full_name = 'ช่างสมชาย' WHERE id = $1`, [fx.tech]);
    await ds.query(`UPDATE users SET full_name = 'ช่างสมหญิง' WHERE id = $1`, [fx.tech2]);
  });

  // --- วางใบพร้อมไทม์ไลน์ ---
  // at = ชั่วโมงที่แล้ว หรือเวลาที่ระบุตรง ๆ · by = คนกด (ค่าเริ่มต้นตามบทบาทของขั้นนั้น)
  interface Ev {
    to: TicketStatus;
    at: number | Date;
    by?: string | null;
    note?: string;
  }
  const when = (at: number | Date): Date => (at instanceof Date ? at : new Date(Date.now() - at * HOUR));
  const story = async (
    asset: string,
    events: Ev[],
    o: {
      priority?: TicketPriority;
      closeReason?: string;
      assignedTo?: string;
      disputed?: boolean;
      deleted?: boolean;
      reporter?: string;
    } = {},
  ): Promise<string> => {
    const [a]: { room_id: string | null }[] = await ds.query(`SELECT room_id FROM assets WHERE id = $1`, [asset]);
    const last = events.at(-1)!;
    const lastResolve = [...events].reverse().find((e) => e.to === 'resolved');
    const done = last.to === 'resolved' || last.to === 'closed';
    const id = await makeTicket(ds, {
      assetId: asset,
      reporterId: o.reporter ?? fx.alice,
      scope: a.room_id ? 'room' : 'common_area',
      roomId: a.room_id,
      status: last.to,
      priority: o.priority ?? 'normal',
      permissionToEnter: a.room_id !== null,
      assignedTo: events.some((e) => e.to === 'assigned') ? (o.assignedTo ?? fx.tech) : null,
      resolvedAt: done && lastResolve ? when(lastResolve.at) : null,
      closedAt: last.to === 'closed' ? when(last.at) : null,
      closeReason: last.to === 'closed' ? (o.closeReason ?? 'user_confirmed') : null,
      reopenCount: events.filter((e, i) => e.to === 'assigned' && events[i - 1]?.to === 'resolved').length,
      disputedAt: o.disputed ? when(last.at) : null,
      deletedAt: o.deleted ? new Date() : null,
    });
    await ds.query(`UPDATE tickets SET created_at = $2 WHERE id = $1`, [id, when(events[0].at)]);
    let from: TicketStatus | null = null;
    for (const e of events) {
      const by =
        e.by !== undefined
          ? e.by
          : e.to === 'open'
            ? fx.alice
            : ['in_progress', 'pending_parts', 'resolved'].includes(e.to)
              ? (o.assignedTo ?? fx.tech)
              : fx.staff;
      await ds.query(
        `INSERT INTO ticket_status_logs (ticket_id, from_status, to_status, actor_id, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, from, e.to, by, e.note ?? null, when(e.at)],
      );
      from = e.to;
    }
    return id;
  };
  const audit = async (ticketId: string, action: string, at: number, detail: object = {}) =>
    ds.query(
      `INSERT INTO ticket_audit_logs (ticket_id, action, actor_id, detail, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [ticketId, action, fx.staff, JSON.stringify(detail), when(at)],
    );

  // ไทม์ไลน์ที่ใช้บ่อย: แจ้ง → มอบหมาย → เริ่ม → เสร็จ (ชั่วโมงที่แล้วของแต่ละขั้น)
  const fixed = (o: number, a: number, s: number, r: number): Ev[] => [
    { to: 'open', at: o },
    { to: 'assigned', at: a },
    { to: 'in_progress', at: s },
    { to: 'resolved', at: r },
  ];

  const http = () => request(app.getHttpServer());
  const get = async (url: string, query: Record<string, unknown> = {}, who = fx.staff) =>
    http()
      .get(url)
      .query(query)
      .set(await bearer(app, who));

  describe('สิทธิ์', () => {
    // @parity test_reports_are_staff_only ×6
    it.each([SUMMARY, STAGES, TECHS])('%s: นักศึกษาและช่าง → 403', async (url) => {
      expect((await get(url, {}, fx.alice)).status).toBe(403);
      expect((await get(url, {}, fx.tech)).status).toBe(403);
    });

    // @parity test_reports_require_login ×3
    it.each([SUMMARY, STAGES, TECHS])('%s: ต้อง login', async (url) => {
      expect((await http().get(url)).status).toBe(401);
    });

    // @parity test_admin_can_read_reports
    it.each([SUMMARY, STAGES, TECHS])('%s: admin อ่านได้', async (url) => {
      expect((await get(url, {}, fx.admin)).status).toBe(200);
    });

    it('ตัวกรองผิดรูปแบบ → 400', async () => {
      expect((await get(SUMMARY, { group_by: 'room' })).status).toBe(400);
      expect((await get(SUMMARY, { from: '1/10/2569' })).status).toBe(400);
      expect((await get(STAGES, { building_id: 'D1' })).status).toBe(400);
    });
  });

  describe('GET /reports/sla-summary', () => {
    // @parity test_summary_groups_by_building_and_category — P*: อาคาร/หมวดมาจาก join assets (DESIGN 9.1)
    it('จัดกลุ่มตามอาคาร × หมวดเป็นค่าเริ่มต้น', async () => {
      await story(fx.ac1, [{ to: 'open', at: 2 }]);
      await story(fx.wh1, [{ to: 'open', at: 2 }]);
      await story(fx.lift2, [{ to: 'open', at: 2 }]);
      const body = (await get(SUMMARY)).body;
      expect(body.group_by).toEqual(['building', 'category']);
      expect(
        body.rows.map((r: { building: { name: string }; category: string; total_tickets: number }) => [
          r.building.name,
          r.category,
          r.total_tickets,
        ]),
      ).toEqual([
        ['อาคาร D1', 'aircon', 1],
        ['อาคาร D1', 'electrical', 1],
        ['อาคาร D2', 'elevator', 1],
      ]);
      expect(body.total).toMatchObject({ total_tickets: 3, open_tickets: 3, closed_tickets: 0 });
    });

    // @parity test_summary_counts_closed_rejected_and_open — + แยก cancelled จาก rejected
    it('นับใบเปิด / ปิด / ไม่รับเรื่อง / ผู้แจ้งถอน แยกช่องกัน', async () => {
      await story(fx.ac1, [...fixed(10, 9, 8, 7), { to: 'closed', at: 6 }]);
      await story(fx.wh1, [
        { to: 'open', at: 5 },
        { to: 'rejected', at: 4, note: 'ไม่ใช่งานซ่อม' },
      ]);
      await story(fx.lift1, [
        { to: 'open', at: 5 },
        { to: 'cancelled', at: 4 },
      ]);
      await story(fx.lift2, [{ to: 'open', at: 3 }]);
      expect((await get(SUMMARY)).body.total).toMatchObject({
        total_tickets: 4,
        open_tickets: 1,
        closed_tickets: 1,
        rejected_tickets: 1,
        cancelled_tickets: 1,
      });
    });

    // @parity test_summary_separates_auto_closed_from_user_confirmed — P*: แยกด้วย close_reason ทั้ง 3 ค่า
    it('แยกใบที่ผู้พักยืนยัน / Staff ยืนยัน / ระบบปิดให้', async () => {
      await story(fx.ac1, [...fixed(100, 99, 98, 97), { to: 'closed', at: 90 }], { closeReason: 'user_confirmed' });
      await story(fx.lift1, [...fixed(100, 99, 98, 97), { to: 'closed', at: 20, by: null }], {
        closeReason: 'auto_closed',
      });
      await story(fx.lift2, [...fixed(100, 99, 98, 97), { to: 'closed', at: 50 }], {
        closeReason: 'staff_confirmed',
        disputed: true,
      });
      expect((await get(SUMMARY)).body.total).toMatchObject({
        closed_tickets: 3,
        user_confirmed: 1,
        staff_confirmed: 1,
        auto_closed: 1,
        // Staff ปิดทั้งที่ยังมีคนแย้ง — ต้องแยกออกมาได้ (DESIGN 3.6)
        closed_while_disputed: 1,
      });
    });

    // @parity test_summary_counts_overdue_and_breached — P*: เทียบกับ SLA_TARGET_HOURS ตอนออกรายงาน (ไม่มี sla_due_at)
    it('นับใบที่ยังไม่เสร็จแต่เลยเป้า และใบที่เสร็จแล้วแต่เกินเป้า', async () => {
      await story(fx.ac1, [{ to: 'open', at: 5 }], { priority: 'urgent' }); // เป้า 4 ชม. — เลยแล้ว
      await story(fx.wh1, [{ to: 'open', at: 5 }]); // normal เป้า 72 — ยังไม่เลย
      await story(fx.lift1, fixed(100, 90, 80, 20)); // ซ่อม 80 ชม. > 72
      await story(fx.lift2, fixed(30, 25, 22, 20)); // ซ่อม 10 ชม.
      expect((await get(SUMMARY)).body.total).toMatchObject({ overdue_open: 1, over_sla: 1 });
    });

    // @parity test_summary_average_hours_to_close — P*: แยกเป็นเวลาซ่อม (จบที่ resolved) + เวลารอยืนยัน
    it('เวลาซ่อมจบที่ resolved และเวลารอยืนยันแยกคอลัมน์', async () => {
      await story(fx.ac1, [...fixed(30, 28, 20, 10), { to: 'closed', at: 4 }]);
      const total = (await get(SUMMARY)).body.total;
      expect(total.avg_repair_hours).toBeCloseTo(20, 1);
      expect(total.median_repair_hours).toBeCloseTo(20, 1);
      expect(total.avg_confirm_hours).toBeCloseTo(6, 1);
    });

    // mutation check: นับ pending_parts เข้า SLA แล้วเทสนี้ต้องแดง
    it('ช่วงรออะไหล่ไม่ถูกนับในเวลาซ่อม', async () => {
      await story(fx.ac1, [
        { to: 'open', at: 50 },
        { to: 'assigned', at: 48 },
        { to: 'in_progress', at: 46 },
        { to: 'pending_parts', at: 40, note: 'รออะไหล่' },
        { to: 'in_progress', at: 10 },
        { to: 'resolved', at: 5 },
      ]);
      // 2 (open) + 2 (assigned) + 6 + 5 (in_progress สองช่วง) = 15 — 30 ชม. ที่รออะไหล่ไม่นับ
      expect((await get(SUMMARY)).body.total.avg_repair_hours).toBeCloseTo(15, 1);
    });

    it('ใบที่ถูกส่งกลับ: ช่วงรอยืนยันรอบก่อนไม่นับเป็นเวลาซ่อม และนับรอบการส่งกลับ', async () => {
      await story(fx.ac1, [
        ...fixed(100, 99, 98, 90),
        { to: 'assigned', at: 60, by: fx.alice, note: 'ยังไม่หาย' },
        { to: 'in_progress', at: 59 },
        { to: 'resolved', at: 50 },
      ]);
      // 1 + 1 + 8 (รอบแรก) + 1 + 9 (รอบสอง) = 20 · 30 ชม. ที่รอผู้พักยืนยันรอบแรกไม่นับ
      const total = (await get(SUMMARY)).body.total;
      expect(total.avg_repair_hours).toBeCloseTo(20, 1);
      expect(total).toMatchObject({ reopened_tickets: 1, reopen_total: 1 });
    });

    // @parity test_summary_filters — P*: building_id / category / ช่วงวันตามเวลาไทย
    it('ตัวกรองอาคาร หมวด และช่วงวัน', async () => {
      await story(fx.ac1, [{ to: 'open', at: 2 }]);
      await story(fx.lift2, [{ to: 'open', at: 2 }]);
      await story(fx.wh1, [{ to: 'open', at: 40 * 24 }]);
      const total = async (q: Record<string, unknown>) => (await get(SUMMARY, q)).body.total.total_tickets;
      expect(await total({ building_id: fx.d1 })).toBe(2);
      expect(await total({ category: 'elevator' })).toBe(1);
      const weekAgo = new Date(Date.now() - 7 * 24 * HOUR).toISOString().slice(0, 10);
      expect(await total({ from: weekAgo })).toBe(2);
    });

    // mutation check: แบ่งเดือนด้วย UTC แทนเวลาไทยแล้วเทสนี้ต้องแดง
    it('ใบที่แจ้ง 01:00 วันที่ 1 (เวลาไทย) อยู่ในเดือนใหม่ ไม่ใช่เดือนก่อน', async () => {
      // 2026-09-30T18:00Z = 1 ต.ค. 2569 01:00 น. เวลาไทย · 16:00Z = 30 ก.ย. 23:00 น. เวลาไทย
      await story(fx.ac1, [{ to: 'open', at: new Date('2026-09-30T18:00:00Z') }]);
      await story(fx.wh1, [{ to: 'open', at: new Date('2026-09-30T16:00:00Z') }]);
      const byMonth = (await get(SUMMARY, { group_by: 'month' })).body.rows.map(
        (r: { month: string; total_tickets: number }) => [r.month, r.total_tickets],
      );
      expect(byMonth).toEqual([
        ['2026-09', 1],
        ['2026-10', 1],
      ]);
      // วันก็เหมือนกัน: from/to คือวันตามปฏิทินไทย
      expect((await get(SUMMARY, { from: '2026-10-01' })).body.total.total_tickets).toBe(1);
      expect((await get(SUMMARY, { to: '2026-09-30' })).body.total.total_tickets).toBe(1);
    });

    it('จัดกลุ่มตามช่างได้ — ใบที่ยังไม่มีช่างอยู่กลุ่ม technician = null', async () => {
      await story(fx.ac1, fixed(10, 9, 8, 7));
      await story(fx.wh1, fixed(10, 9, 8, 7), { assignedTo: fx.tech2 });
      await story(fx.lift1, [{ to: 'open', at: 3 }]);
      const rows = (await get(SUMMARY, { group_by: 'technician' })).body.rows;
      expect(rows.map((r: { technician: { name: string } | null }) => r.technician?.name ?? null)).toEqual([
        'ช่างสมชาย',
        'ช่างสมหญิง',
        null,
      ]);
    });

    // @parity test_empty_report_is_zeroed_not_an_error
    it('ไม่มีใบเลย: ตัวเลขเป็น 0 ค่าเฉลี่ยเป็น null ไม่ใช่ error', async () => {
      const body = (await get(SUMMARY)).body;
      expect(body.rows).toEqual([]);
      expect(body.total).toMatchObject({
        total_tickets: 0,
        over_sla: 0,
        avg_repair_hours: null,
        median_repair_hours: null,
      });
    });
  });

  describe('GET /reports/stage-durations', () => {
    // @parity test_stage_durations_read_from_logs — P*: อ่านจาก v_ticket_stage_durations
    it('เวลาค้างต่อขั้นอ่านจาก log — ใบรวม 10 วันแต่ค้างรอมอบหมาย 7 วัน', async () => {
      await story(fx.ac1, fixed(240, 72, 48, 24));
      const rows = Object.fromEntries(
        ((await get(STAGES)).body as { stage: string }[]).map((r) => [r.stage, r]),
      ) as unknown as Record<string, Record<string, number | boolean | null>>;
      expect(rows.open.avg_hours).toBeCloseTo(168, 1);
      expect(rows.assigned.avg_hours).toBeCloseTo(24, 1);
      expect(rows.in_progress.avg_hours).toBeCloseTo(24, 1);
      // resolved ยังไม่มีขั้นถัดไป = กำลังรอผู้พักยืนยันอยู่ตอนนี้
      expect(rows.resolved).toMatchObject({ completed_count: 0, waiting_now: 1, counted_in_sla: false });
      expect(rows.resolved.max_waiting_hours).toBeCloseTo(24, 1);
      expect(rows.open.counted_in_sla).toBe(true);
    });

    // @parity test_stage_durations_count_tickets_still_waiting
    it('ใบที่ยังค้างอยู่ในขั้นนับเป็น waiting_now ไม่ใช่ completed', async () => {
      await story(fx.ac1, [{ to: 'open', at: 5 }]);
      const [open] = (await get(STAGES)).body;
      expect(open).toMatchObject({ stage: 'open', completed_count: 0, waiting_now: 1 });
      expect(open.max_waiting_hours).toBeCloseTo(5, 1);
    });

    // @parity test_closed_tickets_are_not_counted_as_waiting · test_rejected_tickets_are_not_counted_as_waiting + cancelled
    it('ขั้นปลายทาง (closed / rejected / cancelled) ไม่ขึ้นเป็นขั้นที่ค้าง', async () => {
      await story(fx.ac1, [...fixed(10, 9, 8, 7), { to: 'closed', at: 6 }]);
      await story(fx.wh1, [
        { to: 'open', at: 5 },
        { to: 'rejected', at: 4, note: 'ไม่ใช่งานซ่อม' },
      ]);
      await story(fx.lift1, [
        { to: 'open', at: 5 },
        { to: 'cancelled', at: 4 },
      ]);
      const rows = (await get(STAGES)).body as { stage: string; waiting_now: number }[];
      expect(rows.map((r) => r.stage)).toEqual(['open', 'assigned', 'in_progress', 'resolved']);
      expect(rows.every((r) => r.waiting_now === 0)).toBe(true);
    });

    // @parity test_stage_durations_respect_filters — P*: building_id
    it('ตัวกรองอาคาร', async () => {
      await story(fx.lift2, [
        { to: 'open', at: 5 },
        { to: 'assigned', at: 4 },
      ]);
      expect((await get(STAGES, { building_id: fx.d1 })).body).toEqual([]);
      expect((await get(STAGES, { building_id: fx.d2 })).body).not.toEqual([]);
    });

    // @superseded test_reassignment_does_not_split_the_assigned_stage — เปลี่ยนตัวช่างตอน assigned ลง audit log
    // ไม่เขียน status log (ck_real_transition) ขั้น assigned จึงเป็นก้อนเดียวโดยโครงสร้าง
    it('เปลี่ยนตัวช่างตอน assigned ไม่ทำให้ขั้น assigned แตกเป็นสองก้อน', async () => {
      const t = await story(fx.ac1, [
        { to: 'open', at: 140 },
        { to: 'assigned', at: 100 },
        { to: 'in_progress', at: 40, by: fx.tech2 },
      ]);
      await audit(t, 'reassign', 60, { from: fx.tech, to: fx.tech2 });
      const rows = Object.fromEntries(
        ((await get(STAGES)).body as { stage: string }[]).map((r) => [r.stage, r]),
      ) as unknown as Record<string, { completed_count: number; avg_hours: number }>;
      expect(rows.assigned.completed_count).toBe(1);
      expect(rows.assigned.avg_hours).toBeCloseTo(60, 1);
      expect(rows.open.avg_hours).toBeCloseTo(40, 1);
    });

    // @superseded test_priority_change_rows_do_not_split_a_stage — priority อยู่ใน audit log คนละตาราง
    it('ปรับ priority กลางขั้นไม่ทำให้ขั้นแตก', async () => {
      const t = await story(fx.ac1, [
        { to: 'open', at: 100 },
        { to: 'assigned', at: 40 },
      ]);
      await audit(t, 'priority', 70, { from: 'normal', to: 'urgent' });
      const [open] = (await get(STAGES)).body;
      expect(open.completed_count).toBe(1);
      expect(open.avg_hours).toBeCloseTo(60, 1);
    });
  });

  describe('GET /reports/technicians', () => {
    const techs = async (q: Record<string, unknown> = {}) =>
      Object.fromEntries(
        ((await get(TECHS, q)).body as { technician: { name: string } }[]).map((r) => [r.technician.name, r]),
      ) as unknown as Record<string, Record<string, number | null>>;

    // @parity test_technician_workload
    it('งานในมือ / ซ่อมเสร็จ / ปิดแล้ว — ช่างที่ยังไม่มีงานขึ้นเป็น 0 ไม่ใช่หายไป', async () => {
      await story(fx.ac1, [
        { to: 'open', at: 10 },
        { to: 'assigned', at: 9 },
        { to: 'in_progress', at: 8 },
      ]);
      await story(fx.lift1, [...fixed(10, 9, 8, 7), { to: 'closed', at: 6 }], { closeReason: 'staff_confirmed' });
      const rows = await techs();
      expect(rows['ช่างสมชาย']).toMatchObject({ in_hand: 1, resolved_total: 1, closed_total: 1 });
      expect(rows['ช่างสมหญิง']).toMatchObject({ in_hand: 0, resolved_total: 0, avg_hours_to_resolve: null });
    });

    // @parity test_resolve_time_counts_from_assignment_not_from_report
    it('เวลาของช่างนับจากตอนได้รับงาน ไม่ใช่จากตอนแจ้ง', async () => {
      await story(fx.ac1, fixed(200, 72, 60, 24));
      expect((await techs())['ช่างสมชาย'].avg_hours_to_resolve).toBeCloseTo(48, 1);
    });

    // @superseded test_reassignment_attributes_time_to_the_new_technician — จุดเริ่มของช่างคนใหม่อ่านจาก audit reassign
    it('เปลี่ยนตัวช่าง: เวลานับให้ช่างคนใหม่ตั้งแต่ตอนรับงานต่อ', async () => {
      const t = await story(
        fx.ac1,
        [
          { to: 'open', at: 120 },
          { to: 'assigned', at: 100 },
          { to: 'in_progress', at: 40, by: fx.tech2 },
          { to: 'resolved', at: 25, by: fx.tech2 },
        ],
        { assignedTo: fx.tech2 },
      );
      await audit(t, 'assign', 100, { from: null, to: fx.tech });
      await audit(t, 'reassign', 50, { from: fx.tech, to: fx.tech2 });
      const rows = await techs();
      expect(rows['ช่างสมหญิง'].avg_hours_to_resolve).toBeCloseTo(25, 1);
      expect(rows['ช่างสมชาย'].resolved_total).toBe(0);
    });

    // @superseded test_priority_change_does_not_look_like_a_new_assignment
    it('ปรับ priority กลางงานไม่ถูกนับเป็นการรับงานใหม่', async () => {
      const t = await story(fx.ac1, fixed(100, 72, 48, 24));
      await audit(t, 'priority', 60, { from: 'normal', to: 'urgent' });
      expect((await techs())['ช่างสมชาย'].avg_hours_to_resolve).toBeCloseTo(48, 1);
    });

    it('ช่วงรออะไหล่ไม่นับเป็นเวลาของช่าง', async () => {
      await story(fx.ac1, [
        { to: 'open', at: 60 },
        { to: 'assigned', at: 50 },
        { to: 'in_progress', at: 48 },
        { to: 'pending_parts', at: 40, note: 'รออะไหล่' },
        { to: 'in_progress', at: 10 },
        { to: 'resolved', at: 5 },
      ]);
      expect((await techs())['ช่างสมชาย'].avg_hours_to_resolve).toBeCloseTo(15, 1);
    });

    it('งานที่ถูกส่งกลับนับให้ช่างที่กดซ่อมเสร็จรอบนั้น', async () => {
      await story(fx.ac1, [...fixed(100, 99, 98, 90), { to: 'assigned', at: 60, by: fx.alice, note: 'ยังไม่หาย' }]);
      const rows = await techs();
      expect(rows['ช่างสมชาย']).toMatchObject({ reopen_total: 1, resolved_total: 1, in_hand: 1 });
      expect(rows['ช่างสมหญิง'].reopen_total).toBe(0);
    });

    // @parity test_late_resolved_is_counted — P*: เทียบกับ SLA_TARGET_HOURS ของ priority
    it('นับใบที่ซ่อมเสร็จแต่เกินเป้า SLA ของ priority', async () => {
      await story(fx.ac1, fixed(12, 11, 10, 2), { priority: 'urgent' }); // 10 ชม. > 4
      await story(fx.wh1, fixed(12, 11, 10, 2)); // normal 10 ชม. < 72
      expect((await techs())['ช่างสมชาย'].late_resolved).toBe(1);
    });
  });

  // @parity test_reports_skip_soft_deleted_tickets — ห้ามลบเทสนี้: manager.query() ไม่กรอง @DeleteDateColumn
  // mutation check: เอา deleted_at IS NULL ออกจาก scoped แล้วเทสนี้ต้องแดง
  it('ใบที่ถูกลบแบบ soft ไม่ถูกนับในรายงานใดเลย', async () => {
    await story(fx.ac1, [...fixed(10, 9, 8, 7), { to: 'closed', at: 6 }], { deleted: true });
    await story(fx.lift1, [{ to: 'open', at: 3 }]);
    const summary = (await get(SUMMARY)).body;
    expect(summary.total).toMatchObject({ total_tickets: 1, closed_tickets: 0 });
    expect(summary.rows.map((r: { category: string }) => r.category)).toEqual(['elevator']);
    expect(((await get(STAGES)).body as { stage: string }[]).map((r) => r.stage)).toEqual(['open']);
    const rows = (await get(TECHS)).body as { technician: { name: string }; resolved_total: number }[];
    expect(rows.find((r) => r.technician.name === 'ช่างสมชาย')!.resolved_total).toBe(0);
  });
});
