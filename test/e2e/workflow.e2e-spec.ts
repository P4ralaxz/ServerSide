import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditAction, TicketStatus } from '../../src/domain/enums';
import { bearer, createTestApp, FakeMailService, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser, TicketInput } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const NOBODY = '00000000-0000-4000-8000-000000000000';
const HOUR = 3_600_000;

// workflow ของสัปดาห์ 4: /assign /schedule /status /priority /reject /confirm /cancel
// ทุกตัวต้องผ่าน transition() ตัวเดียวกัน — เทสที่นี่คุมทั้งลำดับการตรวจ (404 → 403 → 409 → 400),
// ตารางฟิลด์ที่ตั้ง/ล้าง (DESIGN 3.6) และการลง log ให้ถูกตาราง
describe('workflow', () => {
  let app: INestApplication;
  let ds: DataSource;
  let mail: FakeMailService;
  let dorm: {
    d1: string;
    room1: string;
    room2: string;
    alice: string;
    roommate: string;
    bob: string;
    staff: string;
    staff2: string;
    admin: string;
    tech: string;
    tech2: string;
    ac1: string;
    wh1: string;
    lift1: string;
  };

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
    resetThrottle(app);
    mail.reset();
    const d1 = await makeBuilding(ds, 'W1');
    const room1 = await makeRoom(ds, d1, '401');
    const room2 = await makeRoom(ds, d1, '402');
    dorm = {
      d1,
      room1,
      room2,
      alice: await makeUser(ds, { roomId: room1, email: 'alice@kmitl.ac.th' }),
      roommate: await makeUser(ds, { roomId: room1, email: 'roommate@kmitl.ac.th' }),
      bob: await makeUser(ds, { roomId: room2, email: 'bob@kmitl.ac.th' }),
      staff: await makeUser(ds, { role: 'staff', email: 'staff@kmitl.ac.th' }),
      staff2: await makeUser(ds, { role: 'staff', email: 'staff2@kmitl.ac.th' }),
      admin: await makeUser(ds, { role: 'admin', email: 'admin@kmitl.ac.th' }),
      tech: await makeUser(ds, { role: 'technician', email: 'tech@kmitl.ac.th' }),
      tech2: await makeUser(ds, { role: 'technician', email: 'tech2@kmitl.ac.th' }),
      ac1: await makeAsset(ds, d1, room1, 'AC-401'),
      wh1: await makeAsset(ds, d1, room1, 'WH-401'),
      lift1: await makeAsset(ds, d1, null, 'LIFT-01'),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);

  const assign = async (actor: string, ticketId: string, technicianId: string) =>
    http()
      .post(`/tickets/${ticketId}/assign`)
      .set(await as(actor))
      .send({ technician_id: technicianId });
  const schedule = async (actor: string, ticketId: string, at: Date) =>
    http()
      .patch(`/tickets/${ticketId}/schedule`)
      .set(await as(actor))
      .send({ scheduled_at: at.toISOString() });
  const setStatus = async (actor: string, ticketId: string, to: TicketStatus, note?: string) =>
    http()
      .post(`/tickets/${ticketId}/status`)
      .set(await as(actor))
      .send(note === undefined ? { to } : { to, note });
  const setPriority = async (actor: string, ticketId: string, priority: string) =>
    http()
      .patch(`/tickets/${ticketId}/priority`)
      .set(await as(actor))
      .send({ priority });
  const reject = async (actor: string, ticketId: string, note?: string) =>
    http()
      .post(`/tickets/${ticketId}/reject`)
      .set(await as(actor))
      .send(note === undefined ? {} : { note });
  const confirm = async (actor: string, ticketId: string) =>
    http()
      .post(`/tickets/${ticketId}/confirm`)
      .set(await as(actor));
  const cancel = async (actor: string, ticketId: string) =>
    http()
      .post(`/tickets/${ticketId}/cancel`)
      .set(await as(actor));
  const history = async (actor: string, ticketId: string) =>
    http()
      .get(`/tickets/${ticketId}/history`)
      .set(await as(actor));

  // ใบที่มีอยู่แล้ว — scope/room_id ตามครุภัณฑ์ เหมือนใบที่สร้างผ่าน API
  const existing = async (
    reporter: string,
    asset: string,
    status: TicketStatus = 'open',
    over: Partial<TicketInput> = {},
  ): Promise<string> => {
    const [a]: { room_id: string | null }[] = await ds.query(`SELECT room_id FROM assets WHERE id = $1`, [asset]);
    const done = new Date(Date.now() - HOUR);
    const id = await makeTicket(ds, {
      assetId: asset,
      reporterId: reporter,
      scope: a.room_id ? 'room' : 'common_area',
      roomId: a.room_id,
      status,
      ...(status === 'assigned' || status === 'in_progress' || status === 'pending_parts'
        ? { assignedTo: dorm.tech }
        : {}),
      ...(status === 'resolved' || status === 'closed' ? { assignedTo: dorm.tech, resolvedAt: done } : {}),
      ...(status === 'closed' ? { closedAt: done, closeReason: 'staff_confirmed' } : {}),
      ...over,
    });
    // ใบที่วางด้วย factory ไม่มี status log ของขั้นก่อนหน้า — ใส่แถวแรกให้ history อ่านได้เหมือนใบจริง
    await ds.query(
      `INSERT INTO ticket_status_logs (ticket_id, from_status, to_status, actor_id) VALUES ($1, NULL, 'open', $2)`,
      [id, reporter],
    );
    return id;
  };

  const row = async (ticketId: string): Promise<Record<string, unknown>> =>
    (await ds.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]))[0];
  const statusLogs = async (ticketId: string): Promise<{ from_status: string | null; to_status: string }[]> =>
    ds.query(
      `SELECT from_status, to_status FROM ticket_status_logs WHERE ticket_id = $1 AND from_status IS NOT NULL
        ORDER BY created_at, id`,
      [ticketId],
    );
  const audits = async (ticketId: string): Promise<{ action: AuditAction; detail: Record<string, unknown> }[]> =>
    ds.query(`SELECT action, detail FROM ticket_audit_logs WHERE ticket_id = $1 ORDER BY created_at, id`, [ticketId]);

  describe('POST /assign', () => {
    // @parity test_staff_assigns_technician_and_writes_log
    it('Staff มอบหมายช่าง → assigned พร้อม status log และ audit assign', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      const res = await assign(dorm.staff, t, dorm.tech);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'assigned', assigned_to: dorm.tech });
      expect(res.body.assignee).toEqual({ id: dorm.tech, name: null });
      expect(await statusLogs(t)).toEqual([{ from_status: 'open', to_status: 'assigned' }]);
      expect(await audits(t)).toEqual([{ action: 'assign', detail: { from: null, to: dorm.tech } }]);
    });

    // @parity test_admin_can_assign_too — ตัดสินแล้ว 12.1: admin ⊇ staff
    it('admin มอบหมายได้เหมือน staff', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      expect((await assign(dorm.admin, t, dorm.tech)).status).toBe(200);
    });

    // @parity test_only_staff_can_assign ×2
    it.each(['alice', 'tech'] as const)('%s มอบหมายไม่ได้ → 403 ที่ชั้น 1', async (who) => {
      const t = await existing(dorm.alice, dorm.lift1);
      expect((await assign(dorm[who], t, dorm.tech)).status).toBe(403);
    });

    // @parity test_assign_requires_login
    it('ต้อง login', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      await http().post(`/tickets/${t}/assign`).send({ technician_id: dorm.tech }).expect(401);
    });

    // @parity test_cannot_assign_to_non_technician / test_cannot_assign_to_suspended_technician / test_assign_unknown_user_is_400
    it.each([
      ['ไม่ใช่ช่าง', () => dorm.alice],
      ['ไม่มีผู้ใช้นี้', () => NOBODY],
    ])('มอบหมายให้ %s → 400', async (_name, target) => {
      const t = await existing(dorm.alice, dorm.lift1);
      const res = await assign(dorm.staff, t, target());
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TECHNICIAN');
      expect(await row(t)).toMatchObject({ status: 'open', assigned_to: null });
    });

    it('มอบหมายให้ช่างที่ถูกระงับ / ถูกลบ → 400', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      await ds.query(`UPDATE users SET is_active = false WHERE id = $1`, [dorm.tech]);
      expect((await assign(dorm.staff, t, dorm.tech)).status).toBe(400);
      await ds.query(`UPDATE users SET is_active = true, deleted_at = now() WHERE id = $1`, [dorm.tech]);
      expect((await assign(dorm.staff, t, dorm.tech)).status).toBe(400);
    });

    // @parity test_assign_unknown_ticket_is_404
    it('ใบที่ไม่มี / ถูกลบแบบ soft → 404', async () => {
      expect((await assign(dorm.staff, NOBODY, dorm.tech)).status).toBe(404);
      const deleted = await existing(dorm.alice, dorm.lift1, 'open', { deletedAt: new Date() });
      expect((await assign(dorm.staff, deleted, dorm.tech)).status).toBe(404);
    });

    // @parity test_reassign_resets_appointment_and_leaves_trail — S: ขั้นไม่เปลี่ยน → audit reassign
    it('เปลี่ยนตัวช่างตอน assigned: ไม่มี status log ใหม่ · audit reassign · ล้างนัด', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned', { scheduledAt: new Date(Date.now() + HOUR) });
      expect((await assign(dorm.staff, t, dorm.tech2)).status).toBe(200);
      expect(await row(t)).toMatchObject({ status: 'assigned', assigned_to: dorm.tech2, scheduled_at: null });
      expect(await statusLogs(t)).toEqual([]);
      expect(await audits(t)).toEqual([{ action: 'reassign', detail: { from: dorm.tech, to: dorm.tech2 } }]);
    });

    // @parity test_reassign_takes_ticket_away_from_previous_technician
    it('ช่างคนเก่าหมดสิทธิ์ทันทีหลังเปลี่ยนตัว', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned');
      await assign(dorm.staff, t, dorm.tech2);
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(404);
      expect((await setStatus(dorm.tech2, t, 'in_progress')).status).toBe(200);
    });

    it('เปลี่ยนตัวช่างตอน in_progress: เขียน status log กลับไป assigned + audit reassign + ล้างนัด', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress', { scheduledAt: new Date(Date.now() + HOUR) });
      expect((await assign(dorm.staff, t, dorm.tech2)).status).toBe(200);
      expect(await row(t)).toMatchObject({ status: 'assigned', assigned_to: dorm.tech2, scheduled_at: null });
      expect(await statusLogs(t)).toEqual([{ from_status: 'in_progress', to_status: 'assigned' }]);
      expect(await audits(t)).toEqual([{ action: 'reassign', detail: { from: dorm.tech, to: dorm.tech2 } }]);
    });

    // @parity test_assigning_same_technician_twice_is_409
    it('มอบหมายช่างคนเดิมซ้ำ → 409 และไม่มี log เพิ่ม', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned');
      const res = await assign(dorm.staff, t, dorm.tech);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_ASSIGNED');
      expect(await audits(t)).toEqual([]);
    });

    // @parity test_cannot_assign_resolved_ticket — S: resolved → assigned ต้องไปทาง /reopen เท่านั้น
    // mutation check: ลบ TRANSITION_ONLY_VIA แล้วเทสนี้ต้องแดง
    it('ใบ resolved: /assign → 409 (ต้องไปทาง /reopen)', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'resolved');
      const res = await assign(dorm.staff, t, dorm.tech2);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(await row(t)).toMatchObject({ status: 'resolved', assigned_to: dorm.tech });
    });

    it.each(['closed', 'rejected', 'cancelled'] as const)('ใบ %s มอบหมายไม่ได้ → 409', async (status) => {
      const t = await existing(dorm.alice, dorm.lift1, status);
      expect((await assign(dorm.staff, t, dorm.tech)).status).toBe(409);
    });
  });

  describe('PATCH /schedule', () => {
    const future = () => new Date(Date.now() + 2 * HOUR);

    // @parity test_technician_schedules_own_job — S: ไม่ใช่สถานะ scheduled แล้ว ลง audit log
    it('ช่างเจ้าของงานนัดเวลาได้ — ขั้นไม่เปลี่ยน ลง audit schedule', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      const at = future();
      const res = await schedule(dorm.tech, t, at);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'assigned' });
      expect(new Date(res.body.scheduled_at as string).getTime()).toBe(at.getTime());
      expect(await statusLogs(t)).toEqual([]);
      expect(await audits(t)).toEqual([{ action: 'schedule', detail: { from: null, to: at.toISOString() } }]);
    });

    // @parity test_technician_cannot_schedule_someone_elses_job
    it('ช่างคนอื่นนัดไม่ได้ → 404 (มองไม่เห็นใบนี้เลย)', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      expect((await schedule(dorm.tech2, t, future())).status).toBe(404);
    });

    // @parity test_staff_can_schedule_any_job
    it.each(['staff', 'admin'] as const)('%s นัดแทนได้', async (who) => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      expect((await schedule(dorm[who], t, future())).status).toBe(200);
    });

    // @parity test_student_cannot_schedule
    it('นักศึกษานัดไม่ได้ → 403 ที่ชั้น 1', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      expect((await schedule(dorm.alice, t, future())).status).toBe(403);
    });

    // @parity test_schedule_in_the_past_is_400
    it('เวลาที่ผ่านไปแล้ว → 400 และไม่บันทึก', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      const res = await schedule(dorm.tech, t, new Date(Date.now() - HOUR));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SCHEDULE_IN_PAST');
      expect(await row(t)).toMatchObject({ scheduled_at: null });
      expect(await audits(t)).toEqual([]);
    });

    // @parity test_reschedule_keeps_every_appointment_in_the_log — S: อยู่ใน audit log
    it('เลื่อนนัดเก็บทุกครั้งใน audit log', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      const first = future();
      const second = new Date(Date.now() + 5 * HOUR);
      await schedule(dorm.tech, t, first);
      await schedule(dorm.tech, t, second);
      expect(await audits(t)).toEqual([
        { action: 'schedule', detail: { from: null, to: first.toISOString() } },
        { action: 'schedule', detail: { from: first.toISOString(), to: second.toISOString() } },
      ]);
    });

    // @parity test_cannot_schedule_before_assigning
    it.each(['open', 'resolved', 'closed'] as const)('ใบ %s นัดไม่ได้ → 409', async (status) => {
      const t = await existing(dorm.alice, dorm.ac1, status);
      const res = await schedule(dorm.staff, t, future());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NOT_SCHEDULABLE');
    });

    it('ใบ pending_parts นัดได้ (ช่างนัดวันที่อะไหล่จะมา)', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'pending_parts');
      expect((await schedule(dorm.tech, t, future())).status).toBe(200);
    });
  });

  describe('POST /status — ช่างเดินงาน', () => {
    // @parity test_full_happy_path — P*: ไม่มีขั้น scheduled
    it('เส้นทางปกติ: assign → start → pending_parts → resume → resolve', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      await assign(dorm.staff, t, dorm.tech);
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(200);
      expect((await setStatus(dorm.tech, t, 'pending_parts', 'รอคาปาซิเตอร์')).status).toBe(200);
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(200);
      const res = await setStatus(dorm.tech, t, 'resolved', 'เปลี่ยนคาปาซิเตอร์แล้ว');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('resolved');
      expect(res.body.resolved_at).not.toBeNull();
      expect(await statusLogs(t)).toEqual([
        { from_status: 'open', to_status: 'assigned' },
        { from_status: 'assigned', to_status: 'in_progress' },
        { from_status: 'in_progress', to_status: 'pending_parts' },
        { from_status: 'pending_parts', to_status: 'in_progress' },
        { from_status: 'in_progress', to_status: 'resolved' },
      ]);
    });

    // @parity test_technician_cannot_close_ticket — กฎหลักข้อ 2
    // mutation check: ให้ technician ไป closed ได้ แล้วเทสนี้ต้องแดง
    it('ช่างปิดใบเองไม่ได้ ทั้งจาก in_progress และ resolved → 409', async () => {
      const a = await existing(dorm.alice, dorm.lift1, 'in_progress');
      expect((await setStatus(dorm.tech, a, 'closed')).status).toBe(409);
      // ครุภัณฑ์คนละชิ้น: idx_tickets_asset_open ยอมให้มีใบเปิดได้ชิ้นละใบ
      const b = await existing(dorm.alice, dorm.ac1, 'resolved');
      expect((await setStatus(dorm.tech, b, 'closed')).status).toBe(409);
      expect(await row(b)).toMatchObject({ status: 'resolved', closed_at: null, close_reason: null });
    });

    // @parity test_status_endpoint_points_to_the_right_one ×2 — S: เหลือ assigned / closed / rejected / cancelled
    it.each(['assigned', 'rejected', 'cancelled'] as const)(
      'ปลายทาง %s ผ่าน /status ไม่ได้ → 409 ไม่ใช่ 400',
      async (to) => {
        const t = await existing(dorm.alice, dorm.lift1, 'in_progress');
        const res = await setStatus(dorm.tech, t, to, 'เหตุผล');
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVALID_TRANSITION');
      },
    );

    // @parity test_cannot_skip_straight_to_resolved
    it('ข้ามจาก assigned ไป resolved ไม่ได้ → 409', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned');
      expect((await setStatus(dorm.tech, t, 'resolved')).status).toBe(409);
    });

    // @parity test_pending_parts_requires_note
    // mutation check: เอา pending_parts ออกจาก NOTE_REQUIRED แล้วเทสนี้ต้องแดง
    it('pending_parts ต้องมี note → ไม่ใส่ได้ 400 และสถานะไม่ขยับ', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress');
      const res = await setStatus(dorm.tech, t, 'pending_parts');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOTE_REQUIRED');
      expect(await row(t)).toMatchObject({ status: 'in_progress' });
      expect(await statusLogs(t)).toEqual([]);
    });

    it('note ของ pending_parts ถูกเก็บลง status log', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress');
      await setStatus(dorm.tech, t, 'pending_parts', 'รอบอร์ดควบคุม');
      const [log]: { note: string }[] = await ds.query(
        `SELECT note FROM ticket_status_logs WHERE ticket_id = $1 AND to_status = 'pending_parts'`,
        [t],
      );
      expect(log.note).toBe('รอบอร์ดควบคุม');
    });

    // @parity test_room_ticket_needs_permission_or_appointment — เคยติด X ตอนสัปดาห์ 2 เพราะ permission_to_enter
    // ถูกตัดออกจาก DESIGN ชั่วคราว · 12.1 ใส่กลับแล้ว (6.7) จึงแปลกลับมา
    it('ใบห้องพักที่ไม่อนุญาตให้เข้าห้องและยังไม่มีนัด → เริ่มงานไม่ได้ 409', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned', { permissionToEnter: false });
      const res = await setStatus(dorm.tech, t, 'in_progress');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPOINTMENT_REQUIRED');

      await schedule(dorm.tech, t, new Date(Date.now() + HOUR));
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(200);
    });

    it('ใบห้องพักที่อนุญาตให้เข้าห้องแล้ว เริ่มงานได้โดยไม่ต้องนัด', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned', { permissionToEnter: true });
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(200);
    });

    // @parity test_common_area_needs_no_permission
    it('ใบส่วนกลางไม่ต้องขออนุญาตเข้าห้อง', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned');
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(200);
    });

    // @parity test_technician_cannot_touch_unassigned_job
    it('ช่างที่ไม่ได้รับงานนี้ → 404 (ชั้น 0 มองไม่เห็น)', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned');
      expect((await setStatus(dorm.tech2, t, 'in_progress')).status).toBe(404);
    });

    // @parity test_student_cannot_change_status / test_staff_cannot_do_technician_steps
    it.each(['alice', 'staff', 'admin'] as const)('%s เดินสถานะแทนช่างไม่ได้ → 403', async (who) => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned');
      expect((await setStatus(dorm[who], t, 'in_progress')).status).toBe(403);
    });

    // @parity test_soft_deleted_ticket_is_404
    it('ใบที่ถูกลบแบบ soft → 404', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned', { deletedAt: new Date() });
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(404);
    });
  });

  describe('POST /reject', () => {
    // @parity test_staff_rejects_new_ticket_with_reason
    it('Staff ไม่รับเรื่องพร้อมเหตุผล — ไม่ตั้ง closed_at และ close_reason', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      const res = await reject(dorm.staff, t, 'ไม่อยู่ในความรับผิดชอบของหอพัก');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
      // ck_closed_after_resolved ห้าม closed_at ในใบที่ไม่เคยผ่าน resolved (DESIGN 3.6)
      expect(await row(t)).toMatchObject({ status: 'rejected', closed_at: null, close_reason: null });
      expect(await statusLogs(t)).toEqual([{ from_status: 'open', to_status: 'rejected' }]);
    });

    it('ไม่ใส่เหตุผล → 400', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      const res = await reject(dorm.staff, t);
      expect(res.status).toBe(400);
      expect(await row(t)).toMatchObject({ status: 'open' });
    });

    // @parity test_technician_cannot_reject
    it.each(['tech', 'alice'] as const)('%s ไม่รับเรื่องแทนไม่ได้ → 403', async (who) => {
      const t = await existing(dorm.alice, dorm.lift1);
      expect((await reject(dorm[who], t, 'เหตุผล')).status).toBe(403);
    });

    // @parity test_cannot_reject_after_assigned — S: DESIGN เปิด assigned → rejected
    it('ใบ assigned ยังไม่รับเรื่องได้ (DESIGN เปิดทางนี้ ต่างจากของเดิม) แต่ in_progress ไม่ได้', async () => {
      const a = await existing(dorm.alice, dorm.lift1, 'assigned');
      expect((await reject(dorm.staff, a, 'ช่างแจ้งว่าไม่ใช่ของหอ')).status).toBe(200);
      const b = await existing(dorm.alice, dorm.lift1, 'in_progress');
      expect((await reject(dorm.staff, b, 'สาย')).status).toBe(409);
    });

    // @parity test_rejected_is_terminal
    it('rejected เป็นสถานะสุดท้าย', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'rejected');
      expect((await assign(dorm.staff, t, dorm.tech)).status).toBe(409);
      expect((await reject(dorm.staff, t, 'อีกครั้ง')).status).toBe(409);
      expect((await cancel(dorm.alice, t)).status).toBe(409);
    });

    // @parity test_failed_transition_writes_nothing — เทสทรานแซกชันหลัก
    it('การเปลี่ยนสถานะที่ล้มเหลวไม่เขียนอะไรเลยทั้ง ticket, status log และ audit log', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'in_progress');
      const before = await row(t);
      expect((await setStatus(dorm.tech, t, 'pending_parts')).status).toBe(400);
      expect((await reject(dorm.staff, t, 'สาย')).status).toBe(409);
      expect((await assign(dorm.staff, t, NOBODY)).status).toBe(400);
      expect(await row(t)).toEqual(before);
      expect(await statusLogs(t)).toEqual([]);
      expect(await audits(t)).toEqual([]);
    });
  });

  describe('PATCH /priority', () => {
    // @parity test_only_staff_changes_priority ×2
    it.each(['staff', 'admin'] as const)('%s ปรับความด่วนได้ — ลง audit priority ไม่ใช่ status log', async (who) => {
      const t = await existing(dorm.alice, dorm.lift1);
      const res = await setPriority(dorm[who], t, 'high');
      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('high');
      expect(await statusLogs(t)).toEqual([]);
      expect(await audits(t)).toEqual([{ action: 'priority', detail: { from: 'normal', to: 'high' } }]);
    });

    it.each(['alice', 'tech'] as const)('%s ปรับความด่วนไม่ได้ → 403', async (who) => {
      const t = await existing(dorm.alice, dorm.lift1);
      expect((await setPriority(dorm[who], t, 'high')).status).toBe(403);
    });

    // @parity test_same_priority_is_409
    it('ตั้งค่าเท่าเดิม → 409 และไม่มี audit', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      const res = await setPriority(dorm.staff, t, 'normal');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRIORITY_UNCHANGED');
      expect(await audits(t)).toEqual([]);
    });

    // @parity test_cannot_change_priority_of_closed_ticket
    it.each(['closed', 'rejected', 'cancelled'] as const)('ใบ %s ปรับความด่วนไม่ได้ → 409', async (status) => {
      const t = await existing(dorm.alice, dorm.lift1, status);
      const res = await setPriority(dorm.staff, t, 'urgent');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TICKET_NOT_OPEN');
    });

    it('ค่านอก enum → 400', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      expect((await setPriority(dorm.staff, t, 'medium')).status).toBe(400);
    });
  });

  describe('POST /confirm', () => {
    // @parity test_room_owner_confirms_and_ticket_closes
    it('ผู้พักยืนยัน → closed · confirmed_by = ตัวเอง · close_reason = user_confirmed', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      const res = await confirm(dorm.alice, t);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'closed', confirmed_by: dorm.alice, close_reason: 'user_confirmed' });
      expect(res.body.closed_at).not.toBeNull();
      expect(await statusLogs(t)).toEqual([{ from_status: 'resolved', to_status: 'closed' }]);
    });

    // @parity test_roommate_can_confirm
    it('รูมเมทยืนยันแทนได้ — สิทธิ์ผูกกับห้อง ไม่ใช่กับผู้แจ้ง', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      const res = await confirm(dorm.roommate, t);
      expect(res.status).toBe(200);
      expect(res.body.confirmed_by).toBe(dorm.roommate);
    });

    // @parity test_other_room_student_cannot_confirm
    it('นักศึกษาห้องอื่นยืนยันไม่ได้ → 403 (เห็นใบไม่ได้อยู่แล้วก็ 404)', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      expect((await confirm(dorm.bob, t)).status).toBe(404);
    });

    // @parity test_technician_cannot_confirm + test_technician_living_in_the_dorm_still_cannot_confirm
    it('ช่างยืนยันไม่ได้ → 403 ที่ชั้น 1 (และบัญชีช่างมีห้องไม่ได้ตั้งแต่ระดับข้อมูล)', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      expect((await confirm(dorm.tech, t)).status).toBe(403);
      await expect(ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [dorm.room1, dorm.tech])).rejects.toThrow();
    });

    // @parity test_staff_cannot_confirm_room_ticket — กฎหลักข้อ 2
    // mutation check: ให้ admin /confirm ใบห้องพักได้ แล้วเทสนี้ต้องแดง
    it.each(['staff', 'admin'] as const)('%s ยืนยันใบห้องพักแทนไม่ได้ → 403', async (who) => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      const res = await confirm(dorm[who], t);
      expect(res.status).toBe(403);
      expect(await row(t)).toMatchObject({ status: 'resolved', confirmed_by: null });
    });

    // @parity test_common_area_is_confirmed_by_staff_not_students
    it('ใบส่วนกลาง: staff ยืนยันได้ (close_reason = staff_confirmed) · นักศึกษาไม่ได้', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'resolved');
      expect((await confirm(dorm.alice, t)).status).toBe(403);
      const res = await confirm(dorm.staff, t);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ close_reason: 'staff_confirmed', confirmed_by: dorm.staff });
    });

    it('ใบส่วนกลาง: admin ยืนยันได้เหมือน staff', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'resolved');
      expect((await confirm(dorm.admin, t)).status).toBe(200);
    });

    // @parity test_cannot_confirm_before_resolved
    it.each(['open', 'assigned', 'in_progress', 'pending_parts'] as const)(
      'ใบ %s ยืนยันไม่ได้ → 409',
      async (status) => {
        const t = await existing(dorm.alice, dorm.ac1, status);
        expect((await confirm(dorm.alice, t)).status).toBe(409);
      },
    );

    // @parity test_cannot_confirm_twice
    it('ยืนยันซ้ำ → 409 และ log มีแถวเดียว', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      expect((await confirm(dorm.alice, t)).status).toBe(200);
      expect((await confirm(dorm.roommate, t)).status).toBe(409);
      expect(await statusLogs(t)).toEqual([{ from_status: 'resolved', to_status: 'closed' }]);
    });

    // @parity test_closed_ticket_frees_the_asset_for_a_new_report
    it('ใบที่ปิดแล้วปล่อยครุภัณฑ์ให้แจ้งใหม่ได้', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      await confirm(dorm.alice, t);
      const res = await http()
        .post('/tickets')
        .set(await as(dorm.alice))
        .send({ items: [{ asset_id: dorm.ac1, title: 'เสียอีกแล้ว', description: 'เสียอีกแล้ว' }] });
      expect(res.status).toBe(201);
    });

    it('Staff ยืนยันใบส่วนกลางที่มีคนแย้งได้ และ disputed_at ไม่ถูกล้าง (รายงานต้องแยกกรณีนี้ออก)', async () => {
      const disputedAt = new Date(Date.now() - HOUR / 2);
      const t = await existing(dorm.alice, dorm.lift1, 'resolved', { disputedAt, reportCount: 2 });
      expect((await confirm(dorm.staff, t)).status).toBe(200);
      const after = await row(t);
      expect(after.status).toBe('closed');
      expect(new Date(after.disputed_at as string).getTime()).toBe(disputedAt.getTime());
    });
  });

  describe('POST /cancel', () => {
    it('ผู้แจ้งถอนใบของตัวเองตอน open ได้ — ไม่ตั้ง closed_at / close_reason', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      const res = await cancel(dorm.alice, t);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
      expect(await row(t)).toMatchObject({ status: 'cancelled', closed_at: null, close_reason: null });
      expect(await statusLogs(t)).toEqual([{ from_status: 'open', to_status: 'cancelled' }]);
    });

    it('รูมเมทถอนใบของคนอื่นไม่ได้ → 403 · staff ก็ไม่ได้ (ชั้น 1)', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      expect((await cancel(dorm.roommate, t)).status).toBe(403);
      expect((await cancel(dorm.staff, t)).status).toBe(403);
    });

    it('มีช่างรับงานแล้วถอนไม่ได้ → 409 (ต้องให้ Staff ไม่รับเรื่องแทน)', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      const res = await cancel(dorm.alice, t);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
    });

    it('ผู้แจ้งที่ย้ายห้องไปแล้วยังถอนใบของตัวเองได้', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [dorm.room2, dorm.alice]);
      expect((await cancel(dorm.alice, t)).status).toBe(200);
    });
  });

  describe('ตารางฟิลด์ที่ตั้ง/ล้าง (DESIGN 3.6)', () => {
    // mutation check: ไม่ล้าง disputed_at ตอนเข้า resolved แล้วเทสนี้ต้องแดง
    it('เข้า resolved รอบใหม่ล้าง disputed_at — ไม่งั้น job ข้ามใบนี้ตลอดกาล', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress', { disputedAt: new Date(Date.now() - HOUR) });
      await setStatus(dorm.tech, t, 'resolved');
      expect(await row(t)).toMatchObject({ status: 'resolved', disputed_at: null });
    });

    it('resolved ตั้ง resolved_at ใหม่ทุกครั้ง', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress');
      const res = await setStatus(dorm.tech, t, 'resolved');
      expect(new Date(res.body.resolved_at as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('auto_close_at: resolved + ไม่มีคนแย้ง = มีค่า · มีคนแย้ง = null · สถานะอื่น = null', async () => {
      const resolvedAt = new Date(Date.now() - HOUR);
      const plain = await existing(dorm.alice, dorm.lift1, 'resolved', { resolvedAt });
      const disputed = await existing(dorm.alice, dorm.ac1, 'resolved', { resolvedAt, disputedAt: new Date() });
      const open = await existing(dorm.alice, dorm.wh1, 'open');

      const detail = async (id: string) =>
        (
          await http()
            .get(`/tickets/${id}`)
            .set(await as(dorm.staff))
        ).body;
      const hours = Number(process.env.AUTO_CLOSE_AFTER_HOURS ?? 72);
      expect(new Date((await detail(plain)).auto_close_at as string).getTime()).toBe(
        resolvedAt.getTime() + hours * HOUR,
      );
      expect((await detail(disputed)).auto_close_at).toBeNull();
      expect((await detail(open)).auto_close_at).toBeNull();
    });

    it('ใบ closed ยังมี closed_at และ confirmed_by ครบ ส่วน auto_close_at เป็น null', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'resolved');
      const res = await confirm(dorm.alice, t);
      expect(res.body.auto_close_at).toBeNull();
      expect(res.body.closed_at).not.toBeNull();
    });
  });

  describe('field ที่หน้าจอใช้ (DESIGN 7.2)', () => {
    it('ใบห้องพักส่งชื่อครุภัณฑ์ ห้อง อาคาร และช่าง ไม่ใช่แค่ uuid', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned');
      await ds.query(`UPDATE users SET full_name = 'สมชาย ใจดี' WHERE id = $1`, [dorm.tech]);
      const res = await http()
        .get(`/tickets/${t}`)
        .set(await as(dorm.alice));
      expect(res.body).toMatchObject({
        asset: { id: dorm.ac1, asset_code: 'AC-401', name: 'ครุภัณฑ์ทดสอบ', category: 'electrical' },
        room: { id: dorm.room1, room_no: '401' },
        building: { id: dorm.d1, name: 'อาคาร W1' },
        assignee: { id: dorm.tech, name: 'สมชาย ใจดี' },
      });
    });

    it('ใบส่วนกลางส่ง room = null แต่ยังมีอาคาร', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      const res = await http()
        .get(`/tickets/${t}`)
        .set(await as(dorm.staff));
      expect(res.body.room).toBeNull();
      expect(res.body.building).toEqual({ id: dorm.d1, name: 'อาคาร W1' });
    });

    it('รายการ (GET /tickets) ส่ง field ชุดเดียวกับรายละเอียด และมี actions ทุกใบ', async () => {
      await existing(dorm.alice, dorm.ac1, 'resolved');
      await existing(dorm.alice, dorm.wh1, 'open');
      const list = (
        await http()
          .get('/tickets')
          .set(await as(dorm.alice))
      ).body as Record<string, unknown>[];
      expect(list).toHaveLength(2);
      for (const item of list) {
        expect(item).toHaveProperty('asset.asset_code');
        expect(item).toHaveProperty('building.name');
        expect(Array.isArray(item.actions)).toBe(true);
      }
    });
  });

  describe('GET /:id/history', () => {
    // @parity test_priority_and_status_both_land_in_one_history — S: รวมสองตารางที่ endpoint นี้
    it('รวม status log และ audit log เรียงตามเวลา พร้อมชื่อคนกดและเวลาค้างต่อขั้น', async () => {
      await ds.query(`UPDATE users SET full_name = 'วิภา สมบูรณ์' WHERE id = $1`, [dorm.staff]);
      const t = await existing(dorm.alice, dorm.lift1);
      await setPriority(dorm.staff, t, 'high');
      await assign(dorm.staff, t, dorm.tech);
      await setStatus(dorm.tech, t, 'in_progress');

      const res = await history(dorm.staff, t);
      expect(res.status).toBe(200);
      const entries = res.body as {
        kind: string;
        action?: string;
        to_status?: string;
        actor: { name: string | null } | null;
      }[];
      expect(entries.map((e) => e.kind)).toEqual(['status', 'audit', 'status', 'audit', 'status']);
      expect(entries.filter((e) => e.kind === 'audit').map((e) => e.action)).toEqual(['priority', 'assign']);
      expect(entries[1].actor).toEqual({ id: dorm.staff, name: 'วิภา สมบูรณ์' });
      // ขั้นสุดท้ายยังเดินอยู่ → นับถึงตอนนี้
      expect(entries.at(-1)).toMatchObject({ kind: 'status', to_status: 'in_progress', duration_seconds: 0 });
    });

    it('ใบที่มองไม่เห็น → 404 เหมือน GET /tickets/:id', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      expect((await history(dorm.bob, t)).status).toBe(404);
      expect((await history(dorm.staff, NOBODY)).status).toBe(404);
    });

    it('ยกระดับ urgent อัตโนมัติขึ้นในประวัติโดยไม่มีชื่อคนกด (actor = null)', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'open', { reportCount: 10 });
      const others = await Promise.all(
        Array.from({ length: 1 }, (_, i) => makeUser(ds, { roomId: dorm.room2, email: `x${i}@kmitl.ac.th` })),
      );
      await http()
        .post(`/tickets/${t}/same-issue`)
        .set(await as(others[0]));
      const entries = (await history(dorm.staff, t)).body as { kind: string; action?: string; actor: unknown }[];
      const escalate = entries.find((e) => e.action === 'auto_escalate');
      expect(escalate).toMatchObject({ kind: 'audit', actor: null });
    });
  });

  describe('อีเมลแจ้งผลซ่อม (DESIGN 6.10)', () => {
    it('ใบห้องพัก: ส่งหาคนที่พักห้องนั้นทุกคน ไม่ส่งหาคนห้องอื่นหรือ staff', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'in_progress', { permissionToEnter: true });
      await setStatus(dorm.tech, t, 'resolved', 'เปลี่ยนคอมเพรสเซอร์');
      expect(mail.resolvedRecipients()).toEqual(['alice@kmitl.ac.th', 'roommate@kmitl.ac.th']);
      expect(mail.resolvedOutbox[0]).toMatchObject({ note: 'เปลี่ยนคอมเพรสเซอร์', where: 'ห้อง 401' });
      expect(mail.resolvedOutbox[0].link).toContain(`/app/tickets/${t}`);
    });

    it('ใบส่วนกลาง: ส่งหา staff ที่ใช้งานอยู่ ไม่ส่งหา admin หรือคนที่ถูกระงับ', async () => {
      await ds.query(`UPDATE users SET is_active = false WHERE id = $1`, [dorm.staff2]);
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress');
      await setStatus(dorm.tech, t, 'resolved');
      expect(mail.resolvedRecipients()).toEqual(['staff@kmitl.ac.th']);
    });

    // mutation check: ย้ายการส่งเมลเข้าไปในทรานแซกชันแล้วเทสนี้ต้องแดง
    // connection อื่นมองไม่เห็นข้อมูลที่ยังไม่ commit — ถ้าเมลออกก่อน commit จะยังอ่านได้เป็น in_progress
    it('เมลออกหลัง commit แล้วเท่านั้น: ตอนเมลถูกส่ง connection อื่นต้องเห็นใบเป็น resolved แล้ว', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress');
      let seenWhenSending: string | null = null;
      mail.onSend = async () => {
        const [r]: { status: string }[] = await ds.query(`SELECT status FROM tickets WHERE id = $1`, [t]);
        seenWhenSending = r.status;
      };
      expect((await setStatus(dorm.tech, t, 'resolved')).status).toBe(200);
      expect(mail.resolvedOutbox.length).toBeGreaterThan(0);
      expect(seenWhenSending).toBe('resolved');
    });

    it('ไม่มีเมลออกเมื่อการเปลี่ยนสถานะล้มเหลว (ทรานแซกชัน rollback)', async () => {
      const t = await existing(dorm.alice, dorm.ac1, 'assigned', { permissionToEnter: true });
      expect((await setStatus(dorm.tech, t, 'resolved')).status).toBe(409);
      expect(mail.resolvedOutbox).toEqual([]);
    });

    it('ส่งเมลไม่สำเร็จ ใบยังเป็น resolved และ endpoint ตอบ 200', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'in_progress');
      mail.mode = 'fail';
      expect((await setStatus(dorm.tech, t, 'resolved')).status).toBe(200);
      expect(await row(t)).toMatchObject({ status: 'resolved' });
    });

    it('ขั้นอื่นไม่ส่งเมล', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'assigned');
      await setStatus(dorm.tech, t, 'in_progress');
      await setPriority(dorm.staff, t, 'high');
      expect(mail.resolvedOutbox).toEqual([]);
    });
  });
});
