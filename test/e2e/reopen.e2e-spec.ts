import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TicketStatus } from '../../src/domain/enums';
import { bearer, createTestApp, FakeMailService, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser, TicketInput } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;

// POST /tickets/:id/reopen (สัปดาห์ 5) — "ยังไม่หาย" กลับไปหาช่างคนเดิม (DESIGN 3.3, 3.6, 6.10)
// สิทธิ์ชุดเดียวกับ /confirm: ใบห้องพัก = คนที่พักห้องนั้น · ใบส่วนกลาง = staff
describe('reopen', () => {
  let app: INestApplication;
  let ds: DataSource;
  let mail: FakeMailService;
  let dorm: {
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
    const d1 = await makeBuilding(ds, 'R1');
    const room1 = await makeRoom(ds, d1, '401');
    const room2 = await makeRoom(ds, d1, '402');
    dorm = {
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

  const reopen = async (actor: string, ticketId: string, note?: string) =>
    http()
      .post(`/tickets/${ticketId}/reopen`)
      .set(await as(actor))
      .send(note === undefined ? {} : { note });
  const setStatus = async (actor: string, ticketId: string, to: TicketStatus) =>
    http()
      .post(`/tickets/${ticketId}/status`)
      .set(await as(actor))
      .send({ to });

  // ใบที่ช่างกดซ่อมเสร็จแล้ว — scope/room_id ตามครุภัณฑ์เหมือนใบที่สร้างผ่าน API
  const existing = async (asset: string, status: TicketStatus = 'resolved', over: Partial<TicketInput> = {}) => {
    const [a]: { room_id: string | null }[] = await ds.query(`SELECT room_id FROM assets WHERE id = $1`, [asset]);
    const done = new Date(Date.now() - HOUR);
    return makeTicket(ds, {
      assetId: asset,
      reporterId: dorm.alice,
      scope: a.room_id ? 'room' : 'common_area',
      roomId: a.room_id,
      status,
      permissionToEnter: a.room_id !== null,
      ...(status === 'open' ? {} : { assignedTo: dorm.tech }),
      ...(status === 'resolved' || status === 'closed' ? { resolvedAt: done } : {}),
      ...(status === 'closed' ? { closedAt: done, closeReason: 'staff_confirmed' } : {}),
      ...over,
    });
  };
  const row = async (ticketId: string): Promise<Record<string, unknown>> =>
    (await ds.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]))[0];
  const statusLogs = async (ticketId: string) =>
    ds.query(`SELECT from_status, to_status, actor_id, note FROM ticket_status_logs WHERE ticket_id = $1 ORDER BY id`, [
      ticketId,
    ]);

  describe('ใครกดได้', () => {
    // @parity test_cannot_assign_resolved_ticket (ครึ่ง /reopen) — ใบ resolved กลับไปหาช่างได้ทาง /reopen เท่านั้น
    it('ผู้พักกด "ยังไม่หาย" → assigned · ช่างคนเดิม · reopen_count + 1 · status log พร้อมเหตุผล', async () => {
      const t = await existing(dorm.ac1);
      const res = await reopen(dorm.alice, t, 'ยังมีเสียงดังตอนเปิดเบอร์ 3');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'assigned',
        assigned_to: dorm.tech,
        reopen_count: 1,
        last_reopen_note: 'ยังมีเสียงดังตอนเปิดเบอร์ 3',
        auto_close_at: null,
      });
      expect(await statusLogs(t)).toEqual([
        { from_status: 'resolved', to_status: 'assigned', actor_id: dorm.alice, note: 'ยังมีเสียงดังตอนเปิดเบอร์ 3' },
      ]);
    });

    it('รูมเมทกดได้ — สิทธิ์ผูกกับห้อง ไม่ใช่กับผู้แจ้ง', async () => {
      const t = await existing(dorm.ac1);
      expect((await reopen(dorm.roommate, t, 'ยังไม่หาย')).status).toBe(200);
    });

    it.each(['staff', 'admin'] as const)('%s ส่งใบห้องพักกลับแทนผู้พักไม่ได้ → 403', async (who) => {
      const t = await existing(dorm.ac1);
      expect((await reopen(dorm[who], t, 'ยังไม่หาย')).status).toBe(403);
      expect(await row(t)).toMatchObject({ status: 'resolved', reopen_count: 0 });
    });

    it('ช่างส่งงานตัวเองกลับไม่ได้ → 403 ที่ชั้น 1', async () => {
      const t = await existing(dorm.ac1);
      expect((await reopen(dorm.tech, t, 'ยังไม่หาย')).status).toBe(403);
    });

    it('นักศึกษาห้องอื่น → 404 (มองไม่เห็นใบนี้)', async () => {
      const t = await existing(dorm.ac1);
      expect((await reopen(dorm.bob, t, 'ยังไม่หาย')).status).toBe(404);
    });

    it.each(['staff', 'admin'] as const)('ใบส่วนกลาง: %s ส่งกลับได้', async (who) => {
      const t = await existing(dorm.lift1);
      const res = await reopen(dorm[who], t, 'ประตูลิฟต์ยังค้างชั้น 3');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'assigned', assigned_to: dorm.tech });
    });

    it('ใบส่วนกลาง: นักศึกษาส่งกลับไม่ได้ (ใช้เจอปัญหาเดียวกันแทน) → 403', async () => {
      const t = await existing(dorm.lift1);
      expect((await reopen(dorm.alice, t, 'ยังไม่หาย')).status).toBe(403);
    });

    // เคสใหม่ของ VIA_ACTION: ปลายทาง assigned เหมือนกัน แต่สิทธิ์มาจาก endpoint ที่เรียก
    it('นักศึกษากด /reopen ได้ แต่กด /assign ไม่ได้ ทั้งที่ปลายทางเป็น assigned ทั้งคู่', async () => {
      const t = await existing(dorm.ac1);
      const assign = await http()
        .post(`/tickets/${t}/assign`)
        .set(await as(dorm.alice))
        .send({ technician_id: dorm.tech2 });
      expect(assign.status).toBe(403);
      expect((await reopen(dorm.alice, t, 'ยังไม่หาย')).status).toBe(200);
    });
  });

  describe('เงื่อนไข', () => {
    it.each([undefined, ''])('ไม่ใส่เหตุผล (%p) → 400 และใบไม่ขยับ', async (note) => {
      const t = await existing(dorm.ac1);
      const res = await reopen(dorm.alice, t, note);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(await row(t)).toMatchObject({ status: 'resolved', reopen_count: 0 });
      expect(await statusLogs(t)).toEqual([]);
    });

    it.each<TicketStatus>(['open', 'assigned', 'in_progress', 'pending_parts', 'closed', 'rejected', 'cancelled'])(
      'ใบ %s ส่งกลับไม่ได้ → 409',
      async (status) => {
        const t = await existing(dorm.ac1, status);
        const res = await reopen(dorm.alice, t, 'ยังไม่หาย');
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVALID_TRANSITION');
      },
    );

    // Staff อยู่ในแถว open/in_progress/pending_parts → assigned ของตารางกฎ (มอบหมาย / เปลี่ยนตัวช่าง)
    // /reopen ต้องไม่กลายเป็นทางลัดของ /assign ที่ได้ใบ assigned โดยไม่ผ่านการตรวจตัวช่าง
    it.each<TicketStatus>(['open', 'in_progress', 'pending_parts'])(
      'Staff ยิง /reopen กับใบส่วนกลางที่ %s → 409 และใบไม่ขยับ',
      async (status) => {
        const t = await existing(dorm.lift1, status);
        const res = await reopen(dorm.staff, t, 'ทดสอบ');
        expect(res.status).toBe(409);
        expect(await row(t)).toMatchObject({ status, reopen_count: 0 });
      },
    );

    it('ใบที่ถูกลบแบบ soft → 404', async () => {
      const t = await existing(dorm.ac1, 'resolved', { deletedAt: new Date() });
      expect((await reopen(dorm.alice, t, 'ยังไม่หาย')).status).toBe(404);
    });
  });

  describe('ฟิลด์ที่ตั้ง/ล้าง (DESIGN 3.6)', () => {
    // mutation check: ไม่ล้าง disputed_at ตอน reopen แล้วเทสนี้ต้องแดง
    it('ใบส่วนกลางที่มีคนแย้ง: reopen ล้าง disputed_at — รอบใหม่ job ต้องปิดได้ตามปกติ', async () => {
      const t = await existing(dorm.lift1, 'resolved', { disputedAt: new Date(Date.now() - HOUR / 2), reportCount: 3 });
      expect((await reopen(dorm.staff, t, 'มีคนแย้ง 3 คน')).status).toBe(200);
      expect(await row(t)).toMatchObject({ disputed_at: null, resolved_at: null, confirmed_by: null, closed_at: null });
    });

    it('ส่งกลับซ้ำได้หลายรอบ reopen_count นับสะสม และ last_reopen_note เป็นของรอบล่าสุด', async () => {
      const t = await existing(dorm.lift1);
      await reopen(dorm.staff, t, 'รอบแรก');
      await setStatus(dorm.tech, t, 'in_progress');
      await setStatus(dorm.tech, t, 'resolved');
      const res = await reopen(dorm.staff2, t, 'รอบสอง');
      expect(res.body).toMatchObject({ reopen_count: 2, last_reopen_note: 'รอบสอง' });
    });

    it('หลังส่งกลับ ช่างคนเดิมเห็นใบและเริ่มงานได้ทันที', async () => {
      const t = await existing(dorm.ac1);
      await reopen(dorm.alice, t, 'ยังไม่หาย');
      const detail = await http()
        .get(`/tickets/${t}`)
        .set(await as(dorm.tech));
      expect(detail.status).toBe(200);
      expect(detail.body.actions).toContain('start');
      expect((await setStatus(dorm.tech, t, 'in_progress')).status).toBe(200);
    });

    it('ปุ่ม reopen อยู่ใน actions ของผู้พักเมื่อใบ resolved (เดิมถูกกรองไว้จนกว่า endpoint จะมี)', async () => {
      const t = await existing(dorm.ac1);
      const detail = await http()
        .get(`/tickets/${t}`)
        .set(await as(dorm.roommate));
      expect(detail.body.actions).toEqual(expect.arrayContaining(['confirm', 'reopen']));
    });
  });

  describe('อีเมลตอนถูกส่งกลับ (DESIGN 6.10)', () => {
    it('ส่งหาช่างเจ้าของงาน + staff ที่ใช้งานอยู่ — ไม่ส่งหาช่างคนอื่น admin หรือคนที่ถูกระงับ', async () => {
      await ds.query(`UPDATE users SET is_active = false WHERE id = $1`, [dorm.staff2]);
      const t = await existing(dorm.ac1);
      await reopen(dorm.alice, t, 'ยังมีเสียงดัง');
      expect(mail.reopenedRecipients()).toEqual(['staff@kmitl.ac.th', 'tech@kmitl.ac.th']);
      const toTech = mail.reopenedOutbox.find((m) => m.email === 'tech@kmitl.ac.th')!;
      expect(toTech).toMatchObject({ note: 'ยังมีเสียงดัง', reopenCount: 1, where: 'ห้อง 401' });
      // ลิงก์ของช่างพาไปหน้างานของช่าง ของ staff พาไปหน้าใบ
      expect(toTech.link).toContain(`/app/jobs/${t}`);
      expect(mail.reopenedOutbox.find((m) => m.email === 'staff@kmitl.ac.th')!.link).toContain(`/app/tickets/${t}`);
    });

    // mutation check: ย้ายการส่งเมลเข้าไปในทรานแซกชันแล้วเทสนี้ต้องแดง
    it('เมลออกหลัง commit แล้วเท่านั้น: ตอนเมลถูกส่ง connection อื่นต้องเห็นใบเป็น assigned แล้ว', async () => {
      const t = await existing(dorm.ac1);
      const seen: string[] = [];
      mail.onSend = async () => {
        const [r]: { status: string }[] = await ds.query(`SELECT status FROM tickets WHERE id = $1`, [t]);
        seen.push(r.status);
      };
      expect((await reopen(dorm.alice, t, 'ยังไม่หาย')).status).toBe(200);
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set(['assigned']));
    });

    it('ไม่มีเมลออกเมื่อส่งกลับไม่สำเร็จ', async () => {
      const t = await existing(dorm.ac1, 'in_progress');
      expect((await reopen(dorm.alice, t, 'ยังไม่หาย')).status).toBe(409);
      expect(mail.reopenedOutbox).toEqual([]);
    });

    it('ส่งเมลไม่สำเร็จ ใบยังถูกส่งกลับและ endpoint ตอบ 200', async () => {
      const t = await existing(dorm.ac1);
      mail.mode = 'fail';
      expect((await reopen(dorm.alice, t, 'ยังไม่หาย')).status).toBe(200);
      expect(await row(t)).toMatchObject({ status: 'assigned' });
    });
  });
});
