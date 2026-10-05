import { DataSource } from 'typeorm';
import {
  AUDIT_ACTIONS,
  CLOSE_REASONS,
  TICKET_PRIORITIES,
  TICKET_SCOPES,
  TICKET_STATUSES,
  USER_ROLES,
} from '../../src/domain/enums';
import { OPEN_STATUSES } from '../../src/domain/status-rules';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

// สัญญาระหว่าง 001_init.sql กับโค้ด TS — สองฝั่งเขียนแยกกัน ถ้าแก้ฝั่งเดียวเทสชุดนี้ต้องแดง
// ห้ามลบ: เป็นด่านเดียวที่จับได้ว่า predicate ของ partial index ไม่ตรงกับ OPEN_STATUSES

describe('schema ↔ code contract', () => {
  let ds: DataSource;
  let building: string;
  let room: string;
  let student: string;

  beforeAll(async () => {
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
  });
  beforeEach(async () => {
    await truncateAll(ds);
    building = await makeBuilding(ds);
    room = await makeRoom(ds, building);
    student = await makeUser(ds, { roomId: room });
  });

  const sqlState = async (p: Promise<unknown>): Promise<string | undefined> =>
    p.then(
      () => undefined,
      (e: { driverError?: { code?: string } }) => e.driverError?.code,
    );

  const constraintOf = async (p: Promise<unknown>): Promise<string | undefined> =>
    p.then(
      () => undefined,
      (e: { driverError?: { constraint?: string } }) => e.driverError?.constraint,
    );

  describe('partial index ตรงกับ OPEN_STATUSES', () => {
    const predicateStatuses = async (index: string): Promise<{ statuses: string[]; def: string }> => {
      const rows: { indexdef: string }[] = await ds.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [
        index,
      ]);
      expect(rows).toHaveLength(1);
      const def = rows[0].indexdef;
      const where = def.slice(def.indexOf(' WHERE '));
      return { def, statuses: [...where.matchAll(/'(\w+)'::ticket_status/g)].map((m) => m[1]).sort() };
    };

    it.each(['idx_tickets_asset_open', 'idx_tickets_reporter_open'])('%s', async (index) => {
      const { statuses, def } = await predicateStatuses(index);
      expect(statuses).toEqual([...OPEN_STATUSES].sort());
      expect(def).toContain('deleted_at IS NULL');
    });

    it('idx_tickets_asset_open เป็น UNIQUE บน asset_id', async () => {
      const { def } = await predicateStatuses('idx_tickets_asset_open');
      expect(def).toMatch(/^CREATE UNIQUE INDEX .* \(asset_id\)/);
    });

    it('OPEN_STATUSES ไม่มี closed / rejected / cancelled', () => {
      expect(OPEN_STATUSES).not.toEqual(expect.arrayContaining(['closed']));
      expect(OPEN_STATUSES).not.toEqual(expect.arrayContaining(['rejected']));
      expect(OPEN_STATUSES).not.toEqual(expect.arrayContaining(['cancelled']));
    });
  });

  describe('enum ใน DB ตรงกับ enum ใน TS', () => {
    it.each([
      ['user_role', USER_ROLES],
      ['ticket_scope', TICKET_SCOPES],
      ['ticket_status', TICKET_STATUSES],
      ['ticket_priority', TICKET_PRIORITIES],
      ['close_reason', CLOSE_REASONS],
      ['audit_action', AUDIT_ACTIONS],
    ] as const)('%s', async (typname, expected) => {
      const rows: { label: string }[] = await ds.query(
        `SELECT e.enumlabel::text AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = $1 ORDER BY e.enumsortorder`,
        [typname],
      );
      expect(rows.map((r) => r.label)).toEqual([...expected]);
    });
  });

  // โค้ดและเทสอ้างชื่อพวกนี้ตรง ๆ (DbErrorFilter ส่งชื่อ constraint ออกไปใน details)
  // ถ้ามีใครลบหรือเปลี่ยนชื่อใน migration กฎจะหายไปเงียบ ๆ โดยที่เทสพฤติกรรมอาจไม่ครอบ
  describe('constraint และ index ที่ตั้งชื่อไว้มีครบ', () => {
    it.each([
      ['ck_real_transition', 'ticket_status_logs'],
      ['ck_scope_room', 'tickets'],
      ['ck_closed', 'tickets'],
      ['ck_closed_after_resolved', 'tickets'],
      ['ck_permission_scope', 'tickets'],
      ['ck_users_email_domain', 'users'],
      ['ck_rooms_capacity', 'rooms'],
    ])('CHECK %s บนตาราง %s', async (name, table) => {
      const rows: { tbl: string }[] = await ds.query(
        `SELECT c.conrelid::regclass::text AS tbl FROM pg_constraint c WHERE c.conname = $1 AND c.contype = 'c'`,
        [name],
      );
      expect(rows).toEqual([{ tbl: table }]);
    });

    it.each([
      ['uq_users_email', 'users', '(email)'],
      ['uq_buildings_code', 'buildings', '(code)'],
      ['uq_rooms_no', 'rooms', '(building_id, room_no)'],
      ['uq_assets_code', 'assets', '(asset_code)'],
      ['uq_assets_qr', 'assets', '(qr_token)'],
      ['idx_tickets_asset_open', 'tickets', '(asset_id)'],
    ])('%s เป็น UNIQUE แบบ partial (ไม่นับแถวที่ถูก soft delete)', async (name, table, columns) => {
      const rows: { tablename: string; indexdef: string }[] = await ds.query(
        `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        [name],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].tablename).toBe(table);
      expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX /);
      expect(rows[0].indexdef).toContain(columns);
      expect(rows[0].indexdef).toMatch(/ WHERE .*deleted_at IS NULL/);
    });

    it.each([
      'idx_tickets_reporter_open',
      'idx_tickets_room',
      'idx_tickets_assignee',
      'idx_tickets_autoclose',
      'idx_status_logs_ticket',
      'idx_audit_logs_ticket',
      'idx_comments_ticket',
      'idx_login_codes_email',
      'idx_login_codes_ip',
    ])('index %s', async (name) => {
      const rows: unknown[] = await ds.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        [name],
      );
      expect(rows).toHaveLength(1);
    });

    it('ห้องที่ capacity ไม่เป็นบวกถูกปฏิเสธ', async () => {
      const p = ds.query(`INSERT INTO rooms (building_id, room_no, floor, capacity) VALUES ($1, '999', 9, 0)`, [
        building,
      ]);
      expect(await constraintOf(p)).toBe('ck_rooms_capacity');
    });
  });

  describe('กันแจ้งซ้ำที่ระดับ DB', () => {
    // สถานะที่ถือว่า "ยังเปิด" ทุกตัวต้องกันใบที่สองได้ — รวม resolved ที่ยังรอยืนยัน
    it.each([...OPEN_STATUSES])('ครุภัณฑ์ที่มีใบ %s อยู่ แจ้งใบที่สองไม่ได้', async (status) => {
      const asset = await makeAsset(ds, building);
      await makeTicket(ds, { assetId: asset, reporterId: student, status });
      const second = makeTicket(ds, { assetId: asset, reporterId: student });
      expect(await constraintOf(second)).toBe('idx_tickets_asset_open');
    });

    it.each(['closed', 'rejected', 'cancelled'] as const)('ใบ %s ไม่กันการแจ้งใหม่', async (status) => {
      const asset = await makeAsset(ds, building);
      const done = new Date();
      await makeTicket(ds, {
        assetId: asset,
        reporterId: student,
        status,
        ...(status === 'closed' ? { resolvedAt: done, closedAt: done, closeReason: 'user_confirmed' } : {}),
      });
      await expect(makeTicket(ds, { assetId: asset, reporterId: student })).resolves.toBeDefined();
    });

    it('ใบที่ถูก soft delete ไม่กันการแจ้งใหม่', async () => {
      const asset = await makeAsset(ds, building);
      await makeTicket(ds, { assetId: asset, reporterId: student, deletedAt: new Date() });
      await expect(makeTicket(ds, { assetId: asset, reporterId: student })).resolves.toBeDefined();
    });
  });

  describe('CHECK ของ tickets', () => {
    // @parity test_smoke.py::test_ticket_room_scope_requires_room
    it('scope = room ต้องมี room_id', async () => {
      const asset = await makeAsset(ds, building, room);
      const p = makeTicket(ds, { assetId: asset, reporterId: student, scope: 'room', roomId: null });
      expect(await constraintOf(p)).toBe('ck_scope_room');
    });

    // @parity test_smoke.py::test_ticket_common_area_must_not_have_room
    it('scope = common_area ห้ามมี room_id', async () => {
      const asset = await makeAsset(ds, building);
      const p = makeTicket(ds, { assetId: asset, reporterId: student, scope: 'common_area', roomId: room });
      expect(await constraintOf(p)).toBe('ck_scope_room');
    });

    // @parity test_smoke.py::test_ticket_common_area_without_room_is_ok
    it('scope = common_area ไม่มี room_id ผ่าน', async () => {
      const asset = await makeAsset(ds, building);
      await expect(makeTicket(ds, { assetId: asset, reporterId: student })).resolves.toBeDefined();
    });

    // @superseded test_smoke.py::test_cannot_close_without_resolve
    // เดิมมี CHECK ตัวเดียว · ใหม่แยกเป็น ck_closed (ต้องมี closed_at + close_reason) กับ ck_closed_after_resolved
    it('closed ต้องมี closed_at และ close_reason', async () => {
      const asset = await makeAsset(ds, building);
      const p = makeTicket(ds, { assetId: asset, reporterId: student, status: 'closed', resolvedAt: new Date() });
      expect(await constraintOf(p)).toBe('ck_closed');
    });

    it('มี closed_at ได้ต้องผ่าน resolved มาก่อน', async () => {
      const asset = await makeAsset(ds, building);
      const p = makeTicket(ds, {
        assetId: asset,
        reporterId: student,
        status: 'closed',
        closedAt: new Date(),
        closeReason: 'auto_closed',
      });
      expect(await constraintOf(p)).toBe('ck_closed_after_resolved');
    });

    it('ใบส่วนกลางตั้ง permission_to_enter ไม่ได้', async () => {
      const asset = await makeAsset(ds, building);
      const p = makeTicket(ds, { assetId: asset, reporterId: student, permissionToEnter: true });
      expect(await constraintOf(p)).toBe('ck_permission_scope');
    });
  });

  describe('กฎอื่นที่ synchronize สร้างให้ไม่ได้', () => {
    it('ticket_status_logs ไม่รับแถว from = to', async () => {
      const asset = await makeAsset(ds, building);
      const ticket = await makeTicket(ds, { assetId: asset, reporterId: student, status: 'assigned' });
      const p = ds.query(
        `INSERT INTO ticket_status_logs (ticket_id, from_status, to_status) VALUES ($1, 'assigned', 'assigned')`,
        [ticket],
      );
      expect(await constraintOf(p)).toBe('ck_real_transition');
    });

    it('log แรกของใบ (NULL → open) ผ่าน ck_real_transition', async () => {
      const asset = await makeAsset(ds, building);
      const ticket = await makeTicket(ds, { assetId: asset, reporterId: student });
      await expect(
        ds.query(`INSERT INTO ticket_status_logs (ticket_id, from_status, to_status) VALUES ($1, NULL, 'open')`, [
          ticket,
        ]),
      ).resolves.toBeDefined();
    });

    // @superseded test_smoke.py::test_status_logs_cascade_on_delete
    // เดิม log ถูกลบตามใบ (CASCADE) · ใหม่ FK เป็น NO ACTION: ระบบใช้ soft delete อย่างเดียว
    // การลบจริงต้อง error ทันที ไม่งั้นประวัติของใบหายไปเงียบ ๆ โดยไม่มีอะไรบอก
    it('ลบแถว tickets ที่มี status log อยู่ไม่ได้ (23503)', async () => {
      const asset = await makeAsset(ds, building);
      const ticket = await makeTicket(ds, { assetId: asset, reporterId: student });
      await ds.query(`INSERT INTO ticket_status_logs (ticket_id, from_status, to_status) VALUES ($1, NULL, 'open')`, [
        ticket,
      ]);

      expect(await sqlState(ds.query(`DELETE FROM tickets WHERE id = $1`, [ticket]))).toBe('23503');
      const logs: unknown[] = await ds.query(`SELECT 1 FROM ticket_status_logs WHERE ticket_id = $1`, [ticket]);
      expect(logs).toHaveLength(1);
    });

    it('ลบแถว tickets ที่มี audit log อยู่ไม่ได้ (23503)', async () => {
      const asset = await makeAsset(ds, building);
      const ticket = await makeTicket(ds, { assetId: asset, reporterId: student });
      await ds.query(`INSERT INTO ticket_audit_logs (ticket_id, action) VALUES ($1, 'priority')`, [ticket]);
      expect(await sqlState(ds.query(`DELETE FROM tickets WHERE id = $1`, [ticket]))).toBe('23503');
    });

    it('ลบแถว users ที่เคยแจ้งซ่อมไม่ได้ (23503)', async () => {
      const asset = await makeAsset(ds, building);
      await makeTicket(ds, { assetId: asset, reporterId: student });
      expect(await sqlState(ds.query(`DELETE FROM users WHERE id = $1`, [student]))).toBe('23503');
    });

    it('trigger อัปเดต updated_at ทุกครั้งที่แก้ใบ', async () => {
      const asset = await makeAsset(ds, building);
      const ticket = await makeTicket(ds, { assetId: asset, reporterId: student });
      await ds.query(`UPDATE tickets SET updated_at = '2000-01-01T00:00:00Z' WHERE id = $1`, [ticket]);
      // ค่าที่ตั้งเองต้องถูก trigger เขียนทับ
      const [row]: { fresh: boolean }[] = await ds.query(
        `SELECT updated_at > now() - interval '1 minute' AS fresh FROM tickets WHERE id = $1`,
        [ticket],
      );
      expect(row.fresh).toBe(true);
    });

    it('อีเมลนอกโดเมนมหาวิทยาลัยถูกปฏิเสธที่ DB', async () => {
      expect(await constraintOf(makeUser(ds, { email: 'someone@gmail.com' }))).toBe('ck_users_email_domain');
    });

    it('อีเมลไม่สนตัวพิมพ์ (citext) — สองแบบอักษรคือบัญชีเดียวกัน', async () => {
      await makeUser(ds, { email: 'Same@kmitl.ac.th' });
      expect(await sqlState(makeUser(ds, { email: 'same@KMITL.ac.th' }))).toBe('23505');
    });

    it('ลบบัญชีแบบ soft แล้วสร้างอีเมลเดิมใหม่ได้', async () => {
      const id = await makeUser(ds, { email: 'again@kmitl.ac.th' });
      await ds.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
      await expect(makeUser(ds, { email: 'again@kmitl.ac.th' })).resolves.toBeDefined();
    });

    it('ไม่มีคอลัมน์ password_hash (passwordless เท่านั้น) และไม่มีตาราง ticket_items', async () => {
      const cols: unknown[] = await ds.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name ILIKE '%password%'`,
      );
      const tables: unknown[] = await ds.query(
        `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ticket_items'`,
      );
      expect(cols).toHaveLength(0);
      expect(tables).toHaveLength(0);
    });

    it('ทุกคอลัมน์เวลาเป็น timestamptz', async () => {
      const rows: { table_name: string; column_name: string }[] = await ds.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type = 'timestamp without time zone' AND table_name <> 'migrations'`,
      );
      expect(rows).toEqual([]);
    });

    it('view v_ticket_stage_durations ข้ามใบที่ถูก soft delete', async () => {
      const a1 = await makeAsset(ds, building);
      const a2 = await makeAsset(ds, building);
      const live = await makeTicket(ds, { assetId: a1, reporterId: student });
      const gone = await makeTicket(ds, { assetId: a2, reporterId: student, deletedAt: new Date() });
      for (const id of [live, gone]) {
        await ds.query(`INSERT INTO ticket_status_logs (ticket_id, from_status, to_status) VALUES ($1, NULL, 'open')`, [
          id,
        ]);
      }
      const rows: { ticket_id: string }[] = await ds.query(`SELECT ticket_id FROM v_ticket_stage_durations`);
      expect(rows.map((r) => r.ticket_id)).toEqual([live]);
    });
  });
});
