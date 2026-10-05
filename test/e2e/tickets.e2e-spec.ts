import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { thaiBuddhistYear } from '../../src/common/time/thai-year';
import { Ticket } from '../../src/database/entities';
import { TicketStatus, UserRole } from '../../src/domain/enums';
import { AUTO_URGENT_REPORT_COUNT, MAX_ITEMS_PER_BATCH, OPEN_TICKET_QUOTA } from '../../src/domain/limits';
import { OPEN_STATUSES } from '../../src/domain/status-rules';
import { TicketCreationService } from '../../src/modules/tickets/ticket-creation.service';
import { TicketPolicy } from '../../src/modules/tickets/ticket-policy.service';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser, ticketNoOf, TicketInput } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const NOBODY = '00000000-0000-4000-8000-000000000000';

describe('tickets', () => {
  let app: INestApplication;
  let ds: DataSource;
  // ห้อง D1-401 มีนักศึกษา 2 คน (รูมเมท) · ห้อง D2-501 มีอีกคน · ครุภัณฑ์ในห้อง + ลิฟต์สองอาคาร
  let dorm: {
    d1: string;
    d2: string;
    room1: string;
    room2: string;
    alice: string;
    roommate: string;
    bob: string;
    homeless: string;
    staff: string;
    tech: string;
    admin: string;
    ac1: string;
    wh1: string;
    bed1: string;
    ac2: string;
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
  beforeEach(async () => {
    await truncateAll(ds);
    resetThrottle(app);
    const d1 = await makeBuilding(ds, 'D1');
    const d2 = await makeBuilding(ds, 'D2');
    const room1 = await makeRoom(ds, d1, '401');
    const room2 = await makeRoom(ds, d2, '501');
    dorm = {
      d1,
      d2,
      room1,
      room2,
      alice: await makeUser(ds, { roomId: room1 }),
      roommate: await makeUser(ds, { roomId: room1 }),
      bob: await makeUser(ds, { roomId: room2 }),
      homeless: await makeUser(ds),
      staff: await makeUser(ds, { role: 'staff' }),
      tech: await makeUser(ds, { role: 'technician' }),
      admin: await makeUser(ds, { role: 'admin' }),
      ac1: await makeAsset(ds, d1, room1, 'AC-D1-401'),
      wh1: await makeAsset(ds, d1, room1, 'WH-D1-401'),
      bed1: await makeAsset(ds, d1, room1, 'BED-D1-401'),
      ac2: await makeAsset(ds, d2, room2, 'AC-D2-501'),
      lift1: await makeAsset(ds, d1, null, 'LIFT-D1-01'),
      lift2: await makeAsset(ds, d2, null, 'LIFT-D2-01'),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  const item = (assetId: string, over: object = {}) => ({
    asset_id: assetId,
    title: 'แอร์ไม่เย็น',
    description: 'มีแต่ลม',
    ...over,
  });
  const post = async (userId: string, ...items: object[]) =>
    http()
      .post('/tickets')
      .set(await as(userId))
      .send({ items });
  const sameIssue = async (userId: string, ticketId: string) =>
    http()
      .post(`/tickets/${ticketId}/same-issue`)
      .set(await as(userId));
  const get = async (userId: string, ticketId: string) =>
    http()
      .get(`/tickets/${ticketId}`)
      .set(await as(userId));
  const list = async (userId: string, query: object = {}): Promise<string[]> =>
    (
      (
        await http()
          .get('/tickets')
          .set(await as(userId))
          .query(query)
          .expect(200)
      ).body as { id: string }[]
    ).map((t) => t.id);
  const countTickets = async (): Promise<number> => (await ds.query(`SELECT count(*)::int AS n FROM tickets`))[0].n;

  // ใบที่มีอยู่แล้วในระบบ — scope / room_id ตามครุภัณฑ์ เหมือนใบที่สร้างผ่าน API
  const existing = async (
    reporter: string,
    asset: string,
    status: TicketStatus = 'open',
    over: Partial<TicketInput> = {},
  ): Promise<string> => {
    const [a]: { room_id: string | null }[] = await ds.query(`SELECT room_id FROM assets WHERE id = $1`, [asset]);
    const done = new Date();
    return makeTicket(ds, {
      assetId: asset,
      reporterId: reporter,
      scope: a.room_id ? 'room' : 'common_area',
      roomId: a.room_id,
      status,
      ...(status === 'resolved' || status === 'closed' ? { resolvedAt: done } : {}),
      ...(status === 'closed' ? { closedAt: done, closeReason: 'staff_confirmed' } : {}),
      ...over,
    });
  };
  // ครุภัณฑ์ส่วนกลางเพิ่มเติมสำหรับเทสที่ต้องมีหลายใบ
  const commons = (n: number): Promise<string[]> =>
    Promise.all(Array.from({ length: n }, (_, i) => makeAsset(ds, dorm.d1, null, `CM-${i}`)));
  const warmPool = () =>
    Promise.all(Array.from({ length: 10 }, () => app.get(DataSource).query(`SELECT pg_sleep(0.05)`)));

  describe('POST /tickets — batch: 1 ticket = 1 ครุภัณฑ์', () => {
    // @parity test_batch_creates_separate_tickets_sharing_batch_id — P*: open / normal / building_id
    it('แจ้ง 3 รายการ ได้ 3 ใบแยกกันที่ batch_id เดียวกัน เลขใบเรียงต่อกัน', async () => {
      const res = await post(dorm.alice, item(dorm.ac1), item(dorm.wh1, { title: 'น้ำอุ่นไม่ร้อน' }), item(dorm.bed1));
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(3);
      expect(res.body.skipped).toEqual([]);
      expect(res.body.batch_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Set(res.body.created.map((t: { batch_id: string }) => t.batch_id))).toEqual(
        new Set([res.body.batch_id]),
      );

      const year = thaiBuddhistYear();
      // เลขใบเรียงตามลำดับที่ส่งมา เหมือนของเดิม
      expect(res.body.created.map((t: { ticket_no: string }) => t.ticket_no)).toEqual([
        `TK-${year}-000001`,
        `TK-${year}-000002`,
        `TK-${year}-000003`,
      ]);
      // ผลลัพธ์เรียงตามที่ส่งมา
      expect(res.body.created.map((t: { asset_id: string }) => t.asset_id)).toEqual([dorm.ac1, dorm.wh1, dorm.bed1]);
      for (const t of res.body.created) {
        expect(t).toMatchObject({
          status: 'open',
          priority: 'normal',
          scope: 'room',
          room_id: dorm.room1,
          building_id: dorm.d1,
          reporter_id: dorm.alice,
          assigned_to: null,
          report_count: 1,
        });
      }
      expect(res.body.created[1].title).toBe('น้ำอุ่นไม่ร้อน');
      // ไม่มีตาราง ticket_items: 3 รายการ = 3 แถวใน tickets
      expect(await countTickets()).toBe(3);
    });

    // @parity test_every_ticket_gets_initial_status_log — P*: NULL → open
    it('ทุกใบได้ status log แรก (NULL → open) และผู้แจ้งถูกนับใน ticket_reporters', async () => {
      await post(dorm.alice, item(dorm.ac1), item(dorm.lift1));
      const logs: { from_status: string | null; to_status: string; actor_id: string }[] = await ds.query(
        `SELECT from_status, to_status, actor_id FROM ticket_status_logs`,
      );
      expect(logs).toHaveLength(2);
      for (const log of logs) expect(log).toEqual({ from_status: null, to_status: 'open', actor_id: dorm.alice });

      const reporters: { user_id: string }[] = await ds.query(`SELECT user_id FROM ticket_reporters`);
      expect(reporters).toEqual([{ user_id: dorm.alice }, { user_id: dorm.alice }]);
      const audits: unknown[] = await ds.query(`SELECT 1 FROM ticket_audit_logs`);
      expect(audits).toHaveLength(0);
    });

    // @superseded test_single_item_has_no_batch_id — batch_id เป็น NOT NULL: ใบเดี่ยวก็มี batch_id ของตัวเอง
    it('แจ้งรายการเดียวก็มี batch_id ของตัวเอง และสองคำขอได้คนละ batch_id', async () => {
      const a = await post(dorm.alice, item(dorm.ac1));
      const b = await post(dorm.alice, item(dorm.wh1));
      expect(a.body.batch_id).toBeTruthy();
      expect(a.body.created[0].batch_id).toBe(a.body.batch_id);
      expect(b.body.batch_id).not.toBe(a.body.batch_id);
    });

    // @superseded test_ticket_no_continues_from_existing — เดิมนับจาก MAX(ticket_no) · ใหม่ใช้ ticket_counters
    it('เลขใบเดินต่อจาก ticket_counters ของปี พ.ศ. นั้น', async () => {
      const year = thaiBuddhistYear();
      await ds.query(`INSERT INTO ticket_counters (be_year, last_no) VALUES ($1, 41)`, [year]);
      const res = await post(dorm.alice, item(dorm.ac1));
      expect(res.body.created[0].ticket_no).toBe(`TK-${year}-000042`);
      const [row]: { last_no: number }[] = await ds.query(`SELECT last_no FROM ticket_counters WHERE be_year = $1`, [
        year,
      ]);
      expect(row.last_no).toBe(42);
    });

    it('รายการที่ซ้ำไม่กินเลขใบ', async () => {
      await existing(dorm.roommate, dorm.ac1);
      const year = thaiBuddhistYear();
      const res = await post(dorm.alice, item(dorm.ac1), item(dorm.wh1));
      expect(res.body.created[0].ticket_no).toBe(`TK-${year}-000001`);
      expect((await post(dorm.alice, item(dorm.bed1))).body.created[0].ticket_no).toBe(`TK-${year}-000002`);
    });

    // @parity test_asset_fills_in_room_and_building — P*: ไม่มี tickets.building
    it('ส่งแค่ asset_id พอ — scope และห้องอ่านจากครุภัณฑ์', async () => {
      const room = (await post(dorm.alice, { asset_id: dorm.ac1, title: 'x' })).body.created[0];
      expect(room).toMatchObject({ asset_id: dorm.ac1, scope: 'room', room_id: dorm.room1, description: null });
      const common = (await post(dorm.alice, { asset_id: dorm.lift2, title: 'x' })).body.created[0];
      expect(common).toMatchObject({ scope: 'common_area', room_id: null, building_id: dorm.d2 });
    });

    // @parity test_permission_to_enter_is_saved
    it('บันทึก permission_to_enter — ค่าเริ่มต้นคือไม่อนุญาต และใช้กับส่วนกลางไม่ได้', async () => {
      const yes = await post(dorm.alice, item(dorm.ac1, { permission_to_enter: true }));
      expect(yes.body.created[0].permission_to_enter).toBe(true);
      expect((await post(dorm.alice, item(dorm.wh1))).body.created[0].permission_to_enter).toBe(false);

      const common = await post(dorm.alice, item(dorm.lift1, { permission_to_enter: true }));
      expect(common.status).toBe(400);
      expect(common.body.code).toBe('PERMISSION_NOT_APPLICABLE');
    });

    // @parity test_too_many_items_is_400
    it(`เกิน ${MAX_ITEMS_PER_BATCH} รายการ → 400`, async () => {
      const assets = await commons(MAX_ITEMS_PER_BATCH + 1);
      const res = await post(dorm.alice, ...assets.map((a) => item(a)));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(await countTickets()).toBe(0);
      expect((await post(dorm.staff, ...assets.slice(0, MAX_ITEMS_PER_BATCH).map((a) => item(a)))).status).toBe(201);
    });

    // @parity test_empty_items_is_400
    it.each([
      { items: [] },
      {},
      { items: 'x' },
      { items: [{ title: 'ไม่มี asset' }] },
      { items: [{ asset_id: 'abc', title: 'x' }] },
    ])('คำขอผิดรูป %j → 400', async (body) => {
      const res = await http()
        .post('/tickets')
        .set(await as(dorm.alice))
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('ไม่มี title หรือส่งฟิลด์ที่ระบบเป็นคนกำหนด (status / priority / reporter_id) → 400', async () => {
      expect((await post(dorm.alice, { asset_id: dorm.ac1 })).status).toBe(400);
      for (const extra of [
        { status: 'closed' },
        { priority: 'urgent' },
        { reporter_id: dorm.bob },
        { assigned_to: dorm.tech },
      ]) {
        expect((await post(dorm.alice, item(dorm.ac1, extra))).status).toBe(400);
      }
      expect(await countTickets()).toBe(0);
    });

    // @parity test_same_asset_twice_in_one_batch_is_400
    it('ครุภัณฑ์เดียวกันสองครั้งในคำขอเดียว → 400 และไม่มีใบถูกสร้าง', async () => {
      const res = await post(dorm.alice, item(dorm.ac1), item(dorm.ac1));
      expect(res.status).toBe(400);
      expect(await countTickets()).toBe(0);
    });
  });

  describe('POST /tickets — สิทธิ์: role (403) → ownership (403) → แจ้งซ้ำ (409)', () => {
    // @parity test_requires_login
    it('ต้อง login', async () => {
      await http()
        .post('/tickets')
        .send({ items: [item(dorm.ac1)] })
        .expect(401);
    });

    // @parity test_layer1_technician_cannot_report
    it.each(['tech', 'admin'] as const)('ชั้น 1: %s แจ้งซ่อมไม่ได้ → 403', async (who) => {
      expect((await post(dorm[who], item(dorm.lift1))).status).toBe(403);
    });

    // @parity test_layer2_cannot_report_other_room — เทสหลักของกฎข้อ 3
    it('ชั้น 2: แจ้งครุภัณฑ์ห้องคนอื่นไม่ได้ → 403', async () => {
      const res = await post(dorm.bob, item(dorm.ac1));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await countTickets()).toBe(0);
    });

    // ถ้าเช็คแจ้งซ้ำก่อน ownership ข้อมูลห้องอื่นจะรั่วผ่าน 409 พร้อม ticket_no
    it('ครุภัณฑ์ห้องคนอื่นที่มีใบเปิดอยู่ ก็ยังได้ 403 ไม่ใช่ 409 และไม่เห็น ticket_no ของห้องนั้น', async () => {
      const ticketNo = await ticketNoOf(ds, await existing(dorm.alice, dorm.ac1));
      const res = await post(dorm.bob, item(dorm.ac1));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(ticketNo);
      expect(res.body.details).toBeUndefined();

      // ปนกับรายการที่ตัวเองมีสิทธิ์ก็ไม่รั่ว
      const mixed = await post(dorm.bob, item(dorm.ac2), item(dorm.ac1));
      expect(mixed.status).toBe(403);
      expect(JSON.stringify(mixed.body)).not.toContain(ticketNo);
    });

    // @parity test_layer2_student_without_room_cannot_report_room
    it('นักศึกษาที่ยังไม่ถูกผูกห้อง แจ้งได้เฉพาะส่วนกลาง', async () => {
      expect((await post(dorm.homeless, item(dorm.ac1))).status).toBe(403);
      expect((await post(dorm.homeless, item(dorm.lift1))).status).toBe(201);
    });

    // @parity test_layer2_staff_also_locked_out_of_rooms
    it('Staff แจ้งแทนห้องพักไม่ได้ — ใบห้องพักต้องมีคนในห้องที่ยืนยันปิดงานได้', async () => {
      expect((await post(dorm.staff, item(dorm.ac1))).status).toBe(403);
      expect((await post(dorm.staff, item(dorm.lift1))).status).toBe(201);
    });

    // @parity test_roommate_can_report_shared_room
    it('รูมเมทแจ้งครุภัณฑ์ในห้องเดียวกันได้', async () => {
      expect((await post(dorm.roommate, item(dorm.ac1))).status).toBe(201);
    });

    // @parity test_common_area_open_across_buildings — ห้ามเพิ่มเงื่อนไขอาคารเดียวกัน
    it('ส่วนกลางเปิดทุกอาคาร: นักศึกษาอาคาร D1 แจ้งลิฟต์อาคาร D2 ได้', async () => {
      const res = await post(dorm.alice, item(dorm.lift2));
      expect(res.status).toBe(201);
      expect(res.body.created[0].building_id).toBe(dorm.d2);
    });

    // @parity test_bad_item_fails_whole_batch
    it('ไม่มีสิทธิ์แม้รายการเดียว → 403 ทั้งคำขอ ไม่ใช่ skipped', async () => {
      const res = await post(dorm.alice, item(dorm.ac1), item(dorm.ac2));
      expect(res.status).toBe(403);
      expect(await countTickets()).toBe(0);
      const logs: unknown[] = await ds.query(`SELECT 1 FROM ticket_status_logs`);
      expect(logs).toHaveLength(0);
    });

    // @parity test_cannot_disguise_room_asset_as_common_area — ช่องโหว่หลบเช็คห้อง
    it('ติดป้ายครุภัณฑ์ห้องคนอื่นเป็นส่วนกลางเพื่อหลบการเช็คห้องไม่ได้', async () => {
      const res = await post(dorm.bob, item(dorm.ac1, { scope: 'common_area' }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SCOPE_MISMATCH');
      expect(await countTickets()).toBe(0);
    });

    // @parity test_room_scope_with_common_asset_is_400
    it('scope = room กับครุภัณฑ์ส่วนกลาง → 400', async () => {
      expect((await post(dorm.alice, item(dorm.lift1, { scope: 'room' }))).status).toBe(400);
    });

    // @parity test_room_id_must_match_asset
    it('room_id ต้องตรงกับห้องของครุภัณฑ์', async () => {
      const res = await post(dorm.alice, item(dorm.ac2, { room_id: dorm.room1 }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ROOM_MISMATCH');
      expect((await post(dorm.alice, item(dorm.ac1, { scope: 'room', room_id: dorm.room1 }))).status).toBe(201);
    });

    // @parity test_deleted_asset_is_404
    it('ครุภัณฑ์ที่ถูกลบแบบ soft หรือไม่มีอยู่ → 404 ทั้งคำขอ', async () => {
      const gone = await makeAsset(ds, dorm.d1);
      await ds.query(`UPDATE assets SET deleted_at = now() WHERE id = $1`, [gone]);
      expect((await post(dorm.alice, item(gone))).status).toBe(404);
      expect((await post(dorm.alice, item(dorm.lift1), item(NOBODY))).status).toBe(404);
      expect(await countTickets()).toBe(0);
    });

    // @parity test_staff_assigns_room_then_student_can_report — ครึ่งหลัง (ครึ่งแรกอยู่ใน users.e2e-spec.ts)
    it('นักศึกษาใหม่แจ้งห้องไม่ได้จนกว่า Staff จะผูกห้องให้', async () => {
      expect((await post(dorm.homeless, item(dorm.ac1))).status).toBe(403);
      await http()
        .patch(`/users/${dorm.homeless}`)
        .set(await as(dorm.staff))
        .send({ room_id: dorm.room2 })
        .expect(200);
      expect((await post(dorm.homeless, item(dorm.ac2))).status).toBe(201);
      expect((await post(dorm.homeless, item(dorm.ac1))).status).toBe(403);
    });
  });

  describe('กันแจ้งซ้ำ', () => {
    // @parity test_duplicate_single_item_is_409_with_ticket_no — P*: body แบบมี code + details.skipped
    it('ครุภัณฑ์ที่มีใบเปิดอยู่ → 409 พร้อม ticket_no ของใบเดิม', async () => {
      const old = await existing(dorm.bob, dorm.lift1);
      const res = await post(dorm.alice, item(dorm.lift1));
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        code: 'DUPLICATE_OPEN_TICKET',
        message: expect.any(String),
        // เป็น array เสมอ แม้คำขอมีรายการเดียว — หน้าเว็บอ่านรูปแบบเดียวกับ 201
        details: { skipped: [{ asset_id: dorm.lift1, ticket_no: await ticketNoOf(ds, old), ticket_id: old }] },
      });
      expect(await countTickets()).toBe(1);
    });

    // @parity test_batch_with_one_duplicate_creates_the_rest
    it('แจ้ง 3 ซ้ำ 1 → 201 สร้าง 2 ใบ + รายงานใน skipped', async () => {
      const old = await existing(dorm.roommate, dorm.ac1);
      const res = await post(dorm.alice, item(dorm.wh1), item(dorm.ac1), item(dorm.bed1));
      expect(res.status).toBe(201);
      expect(res.body.created.map((t: { asset_id: string }) => t.asset_id)).toEqual([dorm.wh1, dorm.bed1]);
      expect(res.body.skipped).toEqual([{ asset_id: dorm.ac1, ticket_no: await ticketNoOf(ds, old), ticket_id: old }]);
      expect(await countTickets()).toBe(3);
      // รายการที่ถูกข้ามไม่ถูกนับเป็นการกด same-issue
      const [row]: { report_count: number }[] = await ds.query(`SELECT report_count FROM tickets WHERE id = $1`, [old]);
      expect(row.report_count).toBe(1);
    });

    // @parity test_all_duplicates_in_batch_is_409
    it('ซ้ำทุกรายการ → 409 พร้อม skipped ครบ', async () => {
      await existing(dorm.bob, dorm.lift1);
      await existing(dorm.bob, dorm.lift2);
      const res = await post(dorm.alice, item(dorm.lift1), item(dorm.lift2));
      expect(res.status).toBe(409);
      expect(res.body.details.skipped.map((s: { asset_id: string }) => s.asset_id)).toEqual([dorm.lift1, dorm.lift2]);
      expect(await countTickets()).toBe(2);
    });

    // @parity test_resolved_and_pending_parts_still_block ×2 — ขยายเป็นทุกค่าใน OPEN_STATUSES
    it.each([...OPEN_STATUSES])('ใบสถานะ %s ยังนับว่าเปิด → แจ้งซ้ำได้ 409', async (status) => {
      await existing(dorm.bob, dorm.lift1, status);
      expect((await post(dorm.alice, item(dorm.lift1))).status).toBe(409);
    });

    // @parity test_closed_or_rejected_does_not_block ×2 — + cancelled ที่เพิ่มใหม่
    it.each(['closed', 'rejected', 'cancelled'] as const)('ใบสถานะ %s ไม่กันการแจ้งใหม่', async (status) => {
      await existing(dorm.bob, dorm.lift1, status);
      expect((await post(dorm.alice, item(dorm.lift1))).status).toBe(201);
    });

    it('ใบเปิดที่ถูกลบแบบ soft ไม่กันการแจ้งใหม่', async () => {
      await existing(dorm.bob, dorm.lift1, 'open', { deletedAt: new Date() });
      expect((await post(dorm.alice, item(dorm.lift1))).status).toBe(201);
    });

    // ของใหม่: ของเดิมบน SQLite ทดสอบไม่ได้
    // ลำดับ lock users → lock ticket_counters → เช็คซ้ำ → จองเลข → INSERT:
    // เช็คซ้ำอยู่หลัง lock ของ counter คนที่แพ้จึงเห็นใบของคนชนะก่อนจองเลข — ไม่มีเลขถูกจองทิ้ง
    it('แจ้งชนกันพร้อมกัน เลขใบไม่ข้าม: ตัวนับเดินเท่าจำนวนใบที่สร้างได้จริง', async () => {
      // ทุกคำขอมีครุภัณฑ์ที่ชนกัน 1 ชิ้น + ของตัวเองอีก 1 ชิ้น: คำขอที่แพ้ยังสร้างใบของตัวเองได้ (ไม่ rollback)
      // ถ้าเช็คซ้ำก่อนได้ lock ทุกคำขอจะจองเลข 2 เลขแล้วใช้จริงเลขเดียว — ตัวนับจะวิ่งเกินจำนวนใบ
      // (คำขอที่ซ้ำทุกรายการใช้พิสูจน์ไม่ได้ เพราะ 409 ทำให้ทั้งทรานแซกชันรวมถึงเลขที่จองถอยกลับ)
      const own = await commons(8);
      await warmPool();
      const results = await Promise.all(own.map((mine) => post(dorm.staff, item(dorm.lift1), item(mine))));

      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(results.filter((r) => r.body.created.length === 2)).toHaveLength(1);
      expect(results.filter((r) => r.body.skipped.length === 1)).toHaveLength(7);
      expect(await countTickets()).toBe(9);

      const [counter]: { last_no: number }[] = await ds.query(`SELECT last_no FROM ticket_counters`);
      expect(counter.last_no).toBe(9);
      const year = thaiBuddhistYear();
      const numbers: { ticket_no: string }[] = await ds.query(`SELECT ticket_no FROM tickets ORDER BY ticket_no`);
      expect(numbers.map((n) => n.ticket_no)).toEqual(
        Array.from({ length: 9 }, (_, i) => `TK-${year}-${String(i + 1).padStart(6, '0')}`),
      );
    });

    // ON CONFLICT เป็นด่านสุดท้าย: จำลองว่าการเช็คซ้ำมองไม่เห็นใบเดิม (เช่น มีทางสร้างใบที่ไม่ผ่าน lock ของ counter)
    // ต้องออกมาเป็น skipped ตามปกติ ไม่ใช่ 23505 ที่ทำให้ทั้งทรานแซกชันพังและใบที่เหลือใน batch สร้างไม่ได้
    it('ถ้าการเช็คซ้ำพลาด ON CONFLICT ยังกันไว้ และใบที่เหลือใน batch ยังถูกสร้าง', async () => {
      const old = await existing(dorm.bob, dorm.lift1);
      const blind = jest
        .spyOn(
          TicketCreationService.prototype as unknown as { findOpenTickets: () => Promise<unknown[]> },
          'findOpenTickets',
        )
        .mockResolvedValueOnce([]);
      try {
        const res = await post(dorm.alice, item(dorm.lift1), item(dorm.lift2));
        expect(res.status).toBe(201);
        expect(res.body.created.map((t: { asset_id: string }) => t.asset_id)).toEqual([dorm.lift2]);
        expect(res.body.skipped).toEqual([
          { asset_id: dorm.lift1, ticket_no: await ticketNoOf(ds, old), ticket_id: old },
        ]);

        blind.mockResolvedValueOnce([]);
        const all = await post(dorm.alice, item(dorm.lift1));
        expect(all.status).toBe(409);
        expect(all.body.code).toBe('DUPLICATE_OPEN_TICKET');
      } finally {
        blind.mockRestore();
      }
      expect(await countTickets()).toBe(2);
    });

    it('แจ้งครุภัณฑ์เดียวกันพร้อมกัน 10 request → สร้างได้ 1 ใบ อีก 9 ได้ 409 (ไม่มี 500)', async () => {
      const users = [dorm.alice, dorm.roommate, dorm.bob, dorm.homeless, dorm.staff];
      await warmPool();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => post(users[i % users.length], item(dorm.lift1))),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, ...Array<number>(9).fill(409)]);
      expect(await countTickets()).toBe(1);
      const winner = results.find((r) => r.status === 201)!.body.created[0].ticket_no;
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('DUPLICATE_OPEN_TICKET');
        expect(r.body.details.skipped[0].ticket_no).toBe(winner);
      }
    });

    it('batch 2 ชุดพร้อมกันที่มีครุภัณฑ์ชุดเดียวกันสลับลำดับ → ไม่ deadlock และแต่ละชิ้นมีใบเดียว', async () => {
      const assets = await commons(6);
      await warmPool();
      for (let round = 0; round < 3; round++) {
        await ds.query(`UPDATE tickets SET status = 'cancelled'`);
        const results = await Promise.all([
          post(dorm.staff, ...assets.map((a) => item(a))),
          post(dorm.staff, ...[...assets].reverse().map((a) => item(a))),
        ]);
        expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
        const open: { asset_id: string; n: number }[] = await ds.query(
          `SELECT asset_id, count(*)::int AS n FROM tickets WHERE status = 'open' GROUP BY asset_id`,
        );
        expect(open).toHaveLength(6);
        expect(open.every((o) => o.n === 1)).toBe(true);
      }
    });

    it('batch 2 ชุดพร้อมกัน → เลขใบไม่ชนและไม่ข้าม', async () => {
      const assets = await commons(10);
      await warmPool();
      const results = await Promise.all([
        post(dorm.staff, ...assets.slice(0, 5).map((a) => item(a))),
        post(dorm.alice, ...assets.slice(5).map((a) => item(a))),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      const year = thaiBuddhistYear();
      const numbers: { ticket_no: string }[] = await ds.query(`SELECT ticket_no FROM tickets ORDER BY ticket_no`);
      expect(numbers.map((n) => n.ticket_no)).toEqual(
        Array.from({ length: 10 }, (_, i) => `TK-${year}-${String(i + 1).padStart(6, '0')}`),
      );
    });
  });

  describe('โควตา: ใบเปิดของผู้แจ้งรวมไม่เกิน 10 ใบ', () => {
    // @superseded test_student_daily_limit — เดิม 5 ใบ/24 ชม. · ใหม่นับใบที่ยังเปิดค้าง
    it(`ใบเปิดครบ ${OPEN_TICKET_QUOTA} ใบแล้ว แจ้งเพิ่ม → 429 QUOTA_EXCEEDED`, async () => {
      const assets = await commons(OPEN_TICKET_QUOTA + 1);
      expect((await post(dorm.alice, ...assets.slice(0, OPEN_TICKET_QUOTA).map((a) => item(a)))).status).toBe(201);
      const res = await post(dorm.alice, item(assets[OPEN_TICKET_QUOTA]));
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        code: 'QUOTA_EXCEEDED',
        message: expect.any(String),
        details: { open_count: OPEN_TICKET_QUOTA, limit: OPEN_TICKET_QUOTA },
      });
      expect(await countTickets()).toBe(OPEN_TICKET_QUOTA);
    });

    // @superseded test_batch_exceeding_quota_is_rejected_whole
    it('batch ที่ทำให้เกินโควตาถูกปฏิเสธทั้งชุด ไม่มีใบ / log / เลขใบค้าง', async () => {
      const assets = await commons(12);
      await post(dorm.alice, ...assets.slice(0, 8).map((a) => item(a)));
      const res = await post(dorm.alice, ...assets.slice(8, 11).map((a) => item(a)));
      expect(res.status).toBe(429);
      expect(res.body.details).toEqual({ open_count: 8, limit: OPEN_TICKET_QUOTA });
      expect(await countTickets()).toBe(8);
      const logs: unknown[] = await ds.query(`SELECT 1 FROM ticket_status_logs`);
      expect(logs).toHaveLength(8);
      const [counter]: { last_no: number }[] = await ds.query(`SELECT last_no FROM ticket_counters`);
      expect(counter.last_no).toBe(8);
      // พอดีโควตายังแจ้งได้
      expect((await post(dorm.alice, ...assets.slice(8, 10).map((a) => item(a)))).status).toBe(201);
    });

    // @superseded test_skipped_items_do_not_use_quota
    it('รายการที่ซ้ำ (skipped) ไม่กินโควตา', async () => {
      const assets = await commons(OPEN_TICKET_QUOTA);
      await existing(dorm.bob, dorm.lift1);
      await post(dorm.alice, ...assets.slice(0, OPEN_TICKET_QUOTA - 1).map((a) => item(a)));
      const res = await post(dorm.alice, item(dorm.lift1), item(assets[OPEN_TICKET_QUOTA - 1]));
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(1);
      expect(res.body.skipped).toHaveLength(1);
    });

    // @superseded test_staff_has_no_daily_limit
    it('staff ไม่มีโควตา', async () => {
      const assets = await commons(20);
      expect((await post(dorm.staff, ...assets.slice(0, 10).map((a) => item(a)))).status).toBe(201);
      expect((await post(dorm.staff, ...assets.slice(10).map((a) => item(a)))).status).toBe(201);
    });

    // @superseded test_quota_window_is_rolling_24h — ไม่มีหน้าต่างเวลาแล้ว: โควตาคืนเมื่อใบปิด ไม่ใช่เมื่อเวลาผ่าน
    it.each(['closed', 'rejected', 'cancelled'] as const)(
      'ใบที่ %s แล้วคืนโควตา — เวลาผ่านไปเฉย ๆ ไม่คืน',
      async (status) => {
        const assets = await commons(OPEN_TICKET_QUOTA + 1);
        await post(dorm.alice, ...assets.slice(0, OPEN_TICKET_QUOTA).map((a) => item(a)));
        await ds.query(`UPDATE tickets SET created_at = now() - interval '30 days'`);
        expect((await post(dorm.alice, item(assets[OPEN_TICKET_QUOTA]))).status).toBe(429);

        await ds.query(
          `UPDATE tickets SET status = $1::ticket_status, resolved_at = now(),
                  closed_at = CASE WHEN $1::text = 'closed' THEN now() END,
                  close_reason = CASE WHEN $1::text = 'closed' THEN 'auto_closed'::close_reason END
           WHERE id = (SELECT id FROM tickets LIMIT 1)`,
          [status],
        );
        expect((await post(dorm.alice, item(assets[OPEN_TICKET_QUOTA]))).status).toBe(201);
      },
    );

    it('นับทั้งใบห้องพักและใบส่วนกลาง และนับเฉพาะใบที่ตัวเองเป็นผู้แจ้ง', async () => {
      const assets = await commons(OPEN_TICKET_QUOTA);
      await post(dorm.alice, item(dorm.ac1), item(dorm.wh1));
      await post(dorm.alice, ...assets.slice(0, OPEN_TICKET_QUOTA - 2).map((a) => item(a)));
      // รูมเมทแจ้งเตียงในห้องเดียวกัน — ไม่นับเป็นโควตาของ alice
      expect((await post(dorm.roommate, item(dorm.bed1))).status).toBe(201);
      expect((await post(dorm.alice, item(assets[OPEN_TICKET_QUOTA - 1]))).status).toBe(429);
    });

    it('batch 2 ชุดพร้อมกันต้องไม่ทะลุโควตา (lock แถว users ก่อนนับ)', async () => {
      await warmPool();
      for (let round = 0; round < 4; round++) {
        // เริ่มรอบใหม่: ยกเลิกใบของรอบก่อนให้โควตากลับมาว่าง
        await ds.query(`UPDATE tickets SET status = 'cancelled'`);
        const assets = await Promise.all(
          Array.from({ length: 12 }, (_, i) => makeAsset(ds, dorm.d1, null, `Q${round}-${i}`)),
        );
        await post(dorm.alice, ...assets.slice(0, 8).map((a) => item(a)));

        const results = await Promise.all([
          post(dorm.alice, item(assets[8]), item(assets[9])),
          post(dorm.alice, item(assets[10]), item(assets[11])),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
        const [row]: { n: number }[] = await ds.query(
          `SELECT count(*)::int AS n FROM tickets WHERE reporter_id = $1 AND status = 'open'`,
          [dorm.alice],
        );
        expect(row.n).toBe(OPEN_TICKET_QUOTA);
      }
    });
  });

  describe('POST /tickets/:id/same-issue', () => {
    // @parity test_same_issue_increments_report_count
    it('เพิ่ม report_count และบันทึกลง ticket_reporters + audit log (ไม่ใช่ status log)', async () => {
      const t = await existing(dorm.bob, dorm.lift1);
      const res = await sameIssue(dorm.alice, t);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: t, report_count: 2, priority: 'normal', status: 'open' });

      const reporters: { user_id: string }[] = await ds.query(
        `SELECT user_id FROM ticket_reporters WHERE ticket_id = $1 ORDER BY created_at`,
        [t],
      );
      expect(reporters.map((r) => r.user_id).sort()).toEqual([dorm.alice, dorm.bob].sort());
      const audits: { action: string; actor_id: string; detail: object }[] = await ds.query(
        `SELECT action, actor_id, detail FROM ticket_audit_logs WHERE ticket_id = $1`,
        [t],
      );
      expect(audits).toEqual([{ action: 'same_issue', actor_id: dorm.alice, detail: { report_count: 2 } }]);
      const logs: unknown[] = await ds.query(`SELECT 1 FROM ticket_status_logs WHERE ticket_id = $1`, [t]);
      expect(logs).toHaveLength(0);
    });

    // @parity test_same_issue_by_reporter_is_409 — P*: ผ่าน ticket_reporters ON CONFLICT
    it('ผู้แจ้งกดใบของตัวเอง → 409 ทั้งใบที่สร้างผ่าน API และใบเดิม', async () => {
      const created = (await post(dorm.alice, item(dorm.lift1))).body.created[0].id as string;
      const res = await sameIssue(dorm.alice, created);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'ALREADY_REPORTED', details: { already_reported: true } });
    });

    // ใหม่: ticket_reporters เป็นของใหม่ทั้งหมด
    it('คนเดิมกดซ้ำ → 409 และ report_count ไม่เพิ่ม', async () => {
      const t = await existing(dorm.bob, dorm.lift1);
      expect((await sameIssue(dorm.alice, t)).status).toBe(200);
      const again = await sameIssue(dorm.alice, t);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ALREADY_REPORTED');
      const [row]: { report_count: number }[] = await ds.query(`SELECT report_count FROM tickets WHERE id = $1`, [t]);
      expect(row.report_count).toBe(2);
    });

    it('คนเดียวกดรัวพร้อมกัน 8 ครั้ง → นับได้ครั้งเดียว', async () => {
      const t = await existing(dorm.bob, dorm.lift1);
      await warmPool();
      const results = await Promise.all(Array.from({ length: 8 }, () => sameIssue(dorm.alice, t)));
      expect(results.map((r) => r.status).sort()).toEqual([200, ...Array<number>(7).fill(409)]);
      const [row]: { report_count: number; reporters: number }[] = await ds.query(
        `SELECT report_count, (SELECT count(*)::int FROM ticket_reporters r WHERE r.ticket_id = t.id) AS reporters
         FROM tickets t WHERE id = $1`,
        [t],
      );
      expect(row).toEqual({ report_count: 2, reporters: 2 });
    });

    it('หลายคนกดพร้อมกัน → report_count เท่ากับจำนวนคนพอดี (ไม่มี lost update)', async () => {
      const t = await existing(dorm.bob, dorm.lift1);
      const crowd = await Promise.all(Array.from({ length: 8 }, () => makeUser(ds)));
      await warmPool();
      const results = await Promise.all(crowd.map((u) => sameIssue(u, t)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const [row]: { report_count: number }[] = await ds.query(`SELECT report_count FROM tickets WHERE id = $1`, [t]);
      expect(row.report_count).toBe(9);
    });

    // @parity test_same_issue_on_closed_ticket_is_409 — + rejected / cancelled
    it.each(['closed', 'rejected', 'cancelled'] as const)('ใบที่ %s แล้ว → 409', async (status) => {
      const t = await existing(dorm.bob, dorm.lift1, status);
      const res = await sameIssue(dorm.alice, t);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'TICKET_NOT_OPEN', details: { status } });
    });

    it.each([...OPEN_STATUSES])('ใบสถานะ %s กดได้', async (status) => {
      const t = await existing(dorm.bob, dorm.lift1, status);
      expect((await sameIssue(dorm.alice, t)).status).toBe(200);
    });

    // @superseded test_same_issue_on_other_room_is_403 — ชั้น 0: ใบห้องอื่นมองไม่เห็น ตอบ 404 ไม่ใช่ 403
    it('ใบห้องอื่น → 404 (403 จะยืนยันว่าใบนั้นมีอยู่) · รูมเมทกดได้', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      const res = await sameIssue(dorm.bob, t);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect((await sameIssue(dorm.roommate, t)).status).toBe(200);
    });

    // ลำดับ ownership (403) ก่อน state (409): ผู้แจ้งที่ย้ายห้องแล้ว "เห็น" ใบได้ แต่ไม่ได้พักห้องนั้นแล้ว
    it('ผู้แจ้งที่ย้ายห้องไปแล้วกดใบห้องเดิม → 403 ไม่ใช่ 409 แม้เคยถูกนับไปแล้วหรือใบปิดแล้ว', async () => {
      const open = await existing(dorm.alice, dorm.ac1);
      const closed = await existing(dorm.alice, dorm.wh1, 'closed');
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [dorm.room2, dorm.alice]);
      expect((await get(dorm.alice, open)).status).toBe(200);
      expect((await sameIssue(dorm.alice, open)).status).toBe(403);
      expect((await sameIssue(dorm.alice, closed)).status).toBe(403);
    });

    // @parity test_same_issue_missing_ticket_is_404
    it('ใบที่ไม่มีอยู่ หรือถูกลบแบบ soft → 404 · id ไม่ใช่ uuid → 400', async () => {
      expect((await sameIssue(dorm.alice, NOBODY)).status).toBe(404);
      const gone = await existing(dorm.bob, dorm.lift1, 'open', { deletedAt: new Date() });
      expect((await sameIssue(dorm.alice, gone)).status).toBe(404);
      expect((await sameIssue(dorm.alice, 'abc')).status).toBe(400);
    });

    // @parity test_technician_cannot_press_same_issue — + staff / admin (ตัดสิน 6 ต.ค.: student เท่านั้น)
    it.each(['tech', 'staff', 'admin'] as const)('%s กดไม่ได้ → 403 ที่ชั้น 1', async (who) => {
      const t = await existing(dorm.bob, dorm.lift1, 'open', { assignedTo: dorm.tech, status: 'assigned' });
      expect((await sameIssue(dorm[who], t)).status).toBe(403);
      await http().post(`/tickets/${t}/same-issue`).expect(401);
    });

    // @parity test_report_count_over_threshold_escalates_to_urgent — P*: ไม่มี sla_due_at · audit auto_escalate
    it(`report_count เกิน ${AUTO_URGENT_REPORT_COUNT} (คนที่ ${AUTO_URGENT_REPORT_COUNT + 1}) → urgent + audit โดยระบบ`, async () => {
      const t = await existing(dorm.bob, dorm.lift1, 'open', { reportCount: AUTO_URGENT_REPORT_COUNT - 1 });

      const atThreshold = (await sameIssue(dorm.alice, t)).body;
      expect(atThreshold).toMatchObject({ report_count: AUTO_URGENT_REPORT_COUNT, priority: 'normal' });

      const over = (await sameIssue(dorm.roommate, t)).body;
      expect(over).toMatchObject({ report_count: AUTO_URGENT_REPORT_COUNT + 1, priority: 'urgent' });

      const audits: { actor_id: string | null; detail: object }[] = await ds.query(
        `SELECT actor_id, detail FROM ticket_audit_logs WHERE ticket_id = $1 AND action = 'auto_escalate'`,
        [t],
      );
      expect(audits).toEqual([
        { actor_id: null, detail: { from: 'normal', to: 'urgent', report_count: AUTO_URGENT_REPORT_COUNT + 1 } },
      ]);
    });

    // ตัดสิน 6 ต.ค. (DESIGN 12.3 ข้อ 6): ยกระดับครั้งเดียวต่อใบ
    it('Staff ลด priority ลงเองหลังถูกยกระดับ → ระบบไม่ยกกลับอีก', async () => {
      const t = await existing(dorm.bob, dorm.lift1, 'open', { reportCount: AUTO_URGENT_REPORT_COUNT });
      expect((await sameIssue(dorm.alice, t)).body.priority).toBe('urgent');
      await ds.query(`UPDATE tickets SET priority = 'low' WHERE id = $1`, [t]);

      const next = (await sameIssue(dorm.roommate, t)).body;
      expect(next).toMatchObject({ report_count: AUTO_URGENT_REPORT_COUNT + 2, priority: 'low' });
      const [row]: { n: number }[] = await ds.query(
        `SELECT count(*)::int AS n FROM ticket_audit_logs WHERE ticket_id = $1 AND action = 'auto_escalate'`,
        [t],
      );
      expect(row.n).toBe(1);
    });

    it('ใบที่เป็น urgent อยู่แล้วไม่ถูกบันทึกว่ายกระดับ', async () => {
      const t = await existing(dorm.bob, dorm.lift1, 'open', {
        reportCount: AUTO_URGENT_REPORT_COUNT,
        priority: 'urgent',
      });
      expect((await sameIssue(dorm.alice, t)).body.priority).toBe('urgent');
      const escalations: unknown[] = await ds.query(`SELECT 1 FROM ticket_audit_logs WHERE action = 'auto_escalate'`);
      expect(escalations).toHaveLength(0);
    });

    // DESIGN 3.4
    it('ใบส่วนกลางที่ resolved แล้วมีคนกด → ตั้ง disputed_at (job ปิดอัตโนมัติจะข้าม) และไม่ถูกเขียนทับเมื่อกดซ้ำ', async () => {
      const t = await existing(dorm.bob, dorm.lift1, 'resolved', { assignedTo: dorm.tech });
      const first = (await sameIssue(dorm.alice, t)).body;
      expect(first.disputed_at).not.toBeNull();
      expect(first.status).toBe('resolved');
      const second = (await sameIssue(dorm.roommate, t)).body;
      expect(second.disputed_at).toBe(first.disputed_at);
    });

    it('ไม่ตั้ง disputed_at ให้ใบห้องพัก หรือใบส่วนกลางที่ยังไม่ resolved', async () => {
      const room = await existing(dorm.alice, dorm.ac1, 'resolved');
      expect((await sameIssue(dorm.roommate, room)).body.disputed_at).toBeNull();
      const common = await existing(dorm.bob, dorm.lift1, 'in_progress');
      expect((await sameIssue(dorm.alice, common)).body.disputed_at).toBeNull();
    });
  });

  describe('การมองเห็น — GET /tickets และ GET /tickets/:id', () => {
    // @superseded test_student_cannot_view_other_room_ticket — 403 → 404 (ชั้น 0)
    it('นักศึกษาห้องอื่นดูใบห้องพักไม่ได้ → 404 · รูมเมทดูได้', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      const res = await get(dorm.bob, t);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', code: 'NOT_FOUND', message: expect.any(String) });
      // ตอบเหมือนใบที่ไม่มีอยู่จริงทุกตัวอักษร — แยกไม่ออกว่าใบ id นี้มีหรือไม่
      expect((await get(dorm.bob, NOBODY)).body).toEqual(res.body);
      expect((await get(dorm.roommate, t)).status).toBe(200);
      expect((await get(dorm.homeless, t)).status).toBe(404);
    });

    // @parity test_everyone_sees_common_area_tickets
    it('นักศึกษาทุกคนเห็นใบส่วนกลางของทุกอาคาร', async () => {
      const t = await existing(dorm.alice, dorm.lift1);
      for (const who of ['bob', 'homeless', 'roommate'] as const) expect((await get(dorm[who], t)).status).toBe(200);
    });

    // @superseded test_technician_sees_only_assigned — 403 → 404
    it('ช่างเห็นเฉพาะใบที่ตัวเองรับ — ใบอื่น 404', async () => {
      const mine = await existing(dorm.alice, dorm.ac1, 'assigned', { assignedTo: dorm.tech });
      const other = await existing(dorm.alice, dorm.lift1);
      const otherTech = await makeUser(ds, { role: 'technician' });
      const theirs = await existing(dorm.bob, dorm.lift2, 'assigned', { assignedTo: otherTech });

      expect((await get(dorm.tech, mine)).status).toBe(200);
      expect((await get(dorm.tech, other)).status).toBe(404);
      expect((await get(dorm.tech, theirs)).status).toBe(404);
      expect(await list(dorm.tech)).toEqual([mine]);
    });

    // @parity test_staff_sees_everything
    it.each(['staff', 'admin'] as const)('%s เห็นทุกใบ', async (who) => {
      const a = await existing(dorm.alice, dorm.ac1);
      const b = await existing(dorm.bob, dorm.ac2);
      expect((await list(dorm[who])).sort()).toEqual([a, b].sort());
      expect((await get(dorm[who], a)).status).toBe(200);
    });

    // @parity test_list_hides_other_rooms_from_student
    it('รายการของนักศึกษาไม่มีใบห้องอื่น', async () => {
      await existing(dorm.alice, dorm.ac1);
      const lift = await existing(dorm.alice, dorm.lift1);
      expect(await list(dorm.bob)).toEqual([lift]);
    });

    it('ผู้แจ้งที่ย้ายห้องยังเห็นใบของตัวเอง · คนที่ย้ายเข้ามาใหม่เห็นใบของห้อง', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [dorm.room2, dorm.alice]);
      await ds.query(`UPDATE users SET room_id = $1 WHERE id = $2`, [dorm.room1, dorm.homeless]);
      expect((await get(dorm.alice, t)).status).toBe(200);
      expect(await list(dorm.alice)).toEqual([t]);
      expect((await get(dorm.homeless, t)).status).toBe(200);
    });

    it('ตัวกรองไม่ช่วยให้เห็นใบที่มองไม่เห็น', async () => {
      const t = await existing(dorm.alice, dorm.ac1);
      const [{ batch_id }]: { batch_id: string }[] = await ds.query(`SELECT batch_id FROM tickets WHERE id = $1`, [t]);
      for (const q of [
        { room_id: dorm.room1 },
        { asset_id: dorm.ac1 },
        { batch_id },
        { building_id: dorm.d1 },
        { scope: 'room' },
      ]) {
        expect(await list(dorm.bob, q)).toEqual([]);
        expect(await list(dorm.tech, q)).toEqual([]);
      }
    });

    // canSee (ใช้หลัง lock แถว) กับ visibilityFilter (ใช้ใน query) เขียนแยกกัน — ต้องให้คำตอบเดียวกันเสมอ
    it('canSee ตรงกับ visibilityFilter ทุกคู่ของ (ผู้ใช้, ใบ)', async () => {
      const policy = app.get(TicketPolicy);
      const otherTech = await makeUser(ds, { role: 'technician' });
      await existing(dorm.alice, dorm.ac1, 'assigned', { assignedTo: dorm.tech });
      await existing(dorm.roommate, dorm.wh1);
      await existing(dorm.bob, dorm.ac2, 'in_progress', { assignedTo: otherTech });
      await existing(dorm.homeless, dorm.lift1);
      await existing(dorm.staff, dorm.lift2, 'resolved', { assignedTo: dorm.tech });
      await existing(dorm.alice, dorm.bed1, 'closed');
      // alice ย้ายออก: มีทั้งใบที่เห็นเพราะเป็นผู้แจ้ง และใบห้องเดิมที่ไม่ควรเห็นแล้ว
      await ds.query(`UPDATE users SET room_id = NULL WHERE id = $1`, [dorm.alice]);

      const users: { id: string; role: UserRole; roomId: string | null }[] = (
        await ds.query(`SELECT id, role, room_id FROM users`)
      ).map((u: { id: string; role: UserRole; room_id: string | null }) => ({
        id: u.id,
        role: u.role,
        roomId: u.room_id,
      }));
      const tickets = await ds.getRepository(Ticket).find();
      expect(tickets).toHaveLength(6);

      for (const user of users) {
        const viaQuery = (
          await policy.visibilityFilter(user, ds.getRepository(Ticket).createQueryBuilder('t')).getMany()
        ).map((t) => t.id);
        const viaCanSee = tickets.filter((t) => policy.canSee(user, t)).map((t) => t.id);
        expect({ role: user.role, ids: viaCanSee.sort() }).toEqual({ role: user.role, ids: viaQuery.sort() });
      }
    });

    // @parity test_list_filters — ชุดตัวกรองเดียวกับของเดิม (ตัดสิน 6 ต.ค.) · building → building_id
    it('กรองตาม batch_id / scope / building_id / status หลายค่า / room_id / asset_id / mine', async () => {
      const res = await post(dorm.alice, item(dorm.ac1), item(dorm.lift2));
      const batchId = res.body.batch_id as string;
      const other = await existing(dorm.bob, dorm.ac2, 'closed');
      const s = dorm.staff;

      expect(await list(s)).toHaveLength(3);
      expect(await list(s, { batch_id: batchId })).toHaveLength(2);
      expect(await list(s, { scope: 'common_area' })).toHaveLength(1);
      expect(await list(s, { building_id: dorm.d2 })).toHaveLength(2);
      expect(await list(s, { building_id: dorm.d1 })).toHaveLength(1);
      expect(await list(s, { status: ['open', 'closed'] })).toHaveLength(3);
      expect(await list(s, { status: 'closed' })).toEqual([other]);
      expect(await list(s, { room_id: dorm.room1 })).toHaveLength(1);
      expect(await list(s, { asset_id: dorm.lift2 })).toHaveLength(1);
      expect(await list(s, { mine: true })).toEqual([]);
      expect(await list(dorm.alice, { mine: true })).toHaveLength(2);
      expect(await list(s, { scope: 'room', status: 'open', building_id: dorm.d1 })).toHaveLength(1);
    });

    it('limit / offset และเรียงใหม่สุดก่อน · ค่าผิด → 400', async () => {
      const assets = await commons(5);
      const ids: string[] = [];
      for (const [i, a] of assets.entries()) {
        ids.push(await existing(dorm.alice, a));
        await ds.query(`UPDATE tickets SET created_at = now() - make_interval(mins => $1) WHERE id = $2`, [
          10 - i,
          ids[i],
        ]);
      }
      const newestFirst = [...ids].reverse();
      expect(await list(dorm.staff)).toEqual(newestFirst);
      expect(await list(dorm.staff, { limit: 2 })).toEqual(newestFirst.slice(0, 2));
      expect(await list(dorm.staff, { limit: 2, offset: 2 })).toEqual(newestFirst.slice(2, 4));

      const h = await as(dorm.staff);
      for (const q of [
        { limit: 0 },
        { limit: 101 },
        { offset: -1 },
        { status: 'new' },
        { scope: 'x' },
        { room_id: 'abc' },
        { mine: 'yes' },
      ]) {
        await http().get('/tickets').set(h).query(q).expect(400);
      }
    });

    it('ต้อง login', async () => {
      await http().get('/tickets').expect(401);
      await http().get(`/tickets/${NOBODY}`).expect(401);
    });

    // @parity test_detail_includes_status_logs — P*: to_status = open
    it('รายละเอียดใบมี status_logs เรียงตามเวลา', async () => {
      const id = (await post(dorm.alice, item(dorm.ac1))).body.created[0].id as string;
      const detail = (await get(dorm.alice, id)).body;
      expect(detail.status_logs).toEqual([
        { from_status: null, to_status: 'open', actor_id: dorm.alice, note: null, created_at: expect.any(String) },
      ]);
      expect(detail).toMatchObject({ id, asset_id: dorm.ac1, building_id: dorm.d1 });
    });

    // @parity test_soft_deleted_ticket_is_404
    it('ใบที่ถูกลบแบบ soft → 404 และไม่อยู่ในรายการ แม้กับ staff', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'open', { deletedAt: new Date() });
      expect((await get(dorm.staff, t)).status).toBe(404);
      expect(await list(dorm.staff)).toEqual([]);
      expect(await list(dorm.alice, { mine: true })).toEqual([]);
    });

    it('ใบของครุภัณฑ์ที่ถูกลบแบบ soft ไปแล้วยังอ่านได้และบอกอาคารได้', async () => {
      const t = await existing(dorm.alice, dorm.lift1, 'closed');
      await ds.query(`UPDATE assets SET deleted_at = now() WHERE id = $1`, [dorm.lift1]);
      expect((await get(dorm.staff, t)).body.building_id).toBe(dorm.d1);
      expect(await list(dorm.staff)).toEqual([t]);
    });

    // @parity test_timestamps_are_utc_aware — P*: ไม่มี sla_due_at
    it('เวลาทุกฟิลด์เป็น ISO 8601 แบบ UTC', async () => {
      const t = (await post(dorm.alice, item(dorm.ac1))).body.created[0];
      for (const field of ['created_at', 'updated_at']) {
        expect(t[field]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(Math.abs(Date.now() - new Date(t[field] as string).getTime())).toBeLessThan(60_000);
      }
    });

    it('id ไม่ใช่ uuid → 400 ไม่ใช่ 500', async () => {
      expect((await get(dorm.staff, 'abc')).status).toBe(400);
    });
  });
});
