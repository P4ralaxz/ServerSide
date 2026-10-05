import { DataSource } from 'typeorm';
import { thaiBuddhistYear } from '../../src/common/time/thai-year';
import { TicketStatus, UserRole } from '../../src/domain/enums';
import { canTransition, OPEN_STATUSES } from '../../src/domain/status-rules';
import { seed } from '../../src/database/seed/seed';
import { openTestDb, truncateAll } from '../setup/truncate';

// seed เขียนตรงลง DB โดยไม่ผ่าน service จึงไม่มีอะไรบังคับให้มันทำตามกฎ นอกจากเทสชุดนี้
// ถ้า seed ผิดกฎ รายงานตอนเดโมจะแสดงตัวเลขที่ระบบจริงสร้างไม่ได้

describe('seed', () => {
  let ds: DataSource;
  // ตรึงเวลา: PRNG ของ seed กำหนดค่าตายตัวอยู่แล้ว เทสจึงได้ข้อมูลชุดเดิมทุกครั้ง
  const now = new Date('2026-10-05T05:00:00Z');

  beforeAll(async () => {
    ds = await openTestDb();
    await truncateAll(ds);
    await seed(ds, now);
  });
  afterAll(async () => {
    await truncateAll(ds);
    await ds.destroy();
  });

  interface Log {
    ticket_id: string;
    from_status: TicketStatus | null;
    to_status: TicketStatus;
    created_at: Date;
    role: UserRole | null;
  }

  const logsByTicket = async (): Promise<Map<string, Log[]>> => {
    const rows: Log[] = await ds.query(
      `SELECT l.ticket_id, l.from_status, l.to_status, l.created_at, u.role
       FROM ticket_status_logs l LEFT JOIN users u ON u.id = l.actor_id
       ORDER BY l.ticket_id, l.created_at, l.id`,
    );
    const map = new Map<string, Log[]>();
    for (const r of rows) map.set(r.ticket_id, [...(map.get(r.ticket_id) ?? []), r]);
    return map;
  };

  it('ทุกใบมี log เริ่มที่ NULL → open ตรงกับเวลาแจ้ง และจบที่สถานะปัจจุบัน', async () => {
    const tickets: { id: string; status: TicketStatus; created_at: Date }[] = await ds.query(
      `SELECT id, status, created_at FROM tickets`,
    );
    const logs = await logsByTicket();
    expect(tickets.length).toBeGreaterThan(30);
    for (const t of tickets) {
      const own = logs.get(t.id) ?? [];
      expect(own[0]).toMatchObject({ from_status: null, to_status: 'open' });
      expect(own[0].created_at.getTime()).toBe(t.created_at.getTime());
      expect(own.at(-1)?.to_status).toBe(t.status);
    }
  });

  it('เวลาของ log เดินไปข้างหน้าจริง ไม่ซ้ำ ไม่ย้อน และไม่เลยเวลาปัจจุบัน', async () => {
    for (const own of (await logsByTicket()).values()) {
      for (let i = 1; i < own.length; i++) {
        expect(own[i].created_at.getTime()).toBeGreaterThan(own[i - 1].created_at.getTime());
        expect(own[i].from_status).toBe(own[i - 1].to_status);
      }
      expect(own.at(-1)!.created_at.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('ทุกการเปลี่ยนขั้นเป็นไปตาม TRANSITIONS และกดโดย role ที่มีสิทธิ์', async () => {
    for (const own of (await logsByTicket()).values()) {
      for (const l of own.slice(1)) {
        expect([
          l.from_status,
          l.to_status,
          l.role,
          canTransition(l.from_status!, l.to_status, l.role ?? 'system'),
        ]).toEqual([l.from_status, l.to_status, l.role, true]);
      }
    }
  });

  it('ไม่มีขั้นไหนค้าง 0 วินาที (รายงานเวลาค้างต่อขั้นจะเป็น 0 ทุกช่อง)', async () => {
    const rows: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM v_ticket_stage_durations
       WHERE left_at IS NOT NULL AND duration <= interval '0'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('มีครบทุกผลลัพธ์ที่รายงานต้องแยกช่อง', async () => {
    const one = async (sql: string): Promise<number> =>
      Number((await ds.query(`SELECT count(*) AS n FROM tickets WHERE ${sql}`))[0].n);
    expect(await one(`close_reason = 'user_confirmed'`)).toBeGreaterThan(0);
    expect(await one(`close_reason = 'staff_confirmed'`)).toBeGreaterThan(0);
    expect(await one(`close_reason = 'auto_closed' AND confirmed_by IS NULL`)).toBeGreaterThan(0);
    expect(await one(`status = 'rejected'`)).toBeGreaterThan(0);
    expect(await one(`status = 'cancelled'`)).toBeGreaterThan(0);
    expect(await one(`reopen_count > 0`)).toBeGreaterThan(0);
    for (const s of OPEN_STATUSES) expect(await one(`status = '${s}'`)).toBeGreaterThan(0);
    const parts: unknown[] = await ds.query(
      `SELECT 1 FROM ticket_status_logs WHERE to_status = 'pending_parts' LIMIT 1`,
    );
    expect(parts).toHaveLength(1);
  });

  it('มีใบ resolved ที่เลย 72 ชม. แล้วอย่างน้อย 2 ใบ ไว้กดโชว์ job ปิดอัตโนมัติ', async () => {
    const due: unknown[] = await ds.query(
      `SELECT 1 FROM tickets
       WHERE status = 'resolved' AND deleted_at IS NULL AND disputed_at IS NULL
         AND resolved_at < $1::timestamptz - interval '72 hours'`,
      [now],
    );
    expect(due.length).toBeGreaterThanOrEqual(2);
  });

  it('มีใบส่วนกลางที่ถูกโต้แย้งหลัง resolved (job ต้องข้าม) และ report_count ตรงกับ ticket_reporters', async () => {
    const disputed: unknown[] = await ds.query(
      `SELECT 1 FROM tickets WHERE disputed_at IS NOT NULL AND scope = 'common_area' AND status = 'resolved'`,
    );
    expect(disputed.length).toBeGreaterThan(0);
    const mismatch: unknown[] = await ds.query(
      `SELECT 1 FROM tickets t
       WHERE t.report_count <> (SELECT count(*) FROM ticket_reporters r WHERE r.ticket_id = t.id)`,
    );
    expect(mismatch).toHaveLength(0);
  });

  it('ใบกระจายข้ามเดือน (เวลาไทย) และข้ามอาคาร ไม่งั้นการจัดกลุ่มรายงานมีกลุ่มเดียว', async () => {
    const [row]: { months: string; buildings: string }[] = await ds.query(
      `SELECT count(DISTINCT date_trunc('month', t.created_at AT TIME ZONE 'Asia/Bangkok')) AS months,
              count(DISTINCT a.building_id) AS buildings
       FROM tickets t JOIN assets a ON a.id = t.asset_id`,
    );
    expect(Number(row.months)).toBeGreaterThanOrEqual(2);
    expect(Number(row.buildings)).toBe(2);
  });

  it('ใบห้องพัก: ผู้แจ้งพักห้องนั้นจริง และครุภัณฑ์อยู่ในห้องนั้น', async () => {
    const bad: unknown[] = await ds.query(
      `SELECT 1 FROM tickets t JOIN users u ON u.id = t.reporter_id JOIN assets a ON a.id = t.asset_id
       WHERE t.scope = 'room' AND (u.room_id IS DISTINCT FROM t.room_id OR a.room_id IS DISTINCT FROM t.room_id)`,
    );
    expect(bad).toHaveLength(0);
  });

  it('ใบ closed มี close_reason และ closed_at ทุกใบ · ใบที่ไม่ใช่ closed ไม่มีทั้งสองอย่าง', async () => {
    const bad: unknown[] = await ds.query(
      `SELECT 1 FROM tickets
       WHERE (status = 'closed') <> (close_reason IS NOT NULL) OR (status = 'closed') <> (closed_at IS NOT NULL)`,
    );
    expect(bad).toHaveLength(0);
  });

  it('ใบ auto_closed ไม่มีผู้ยืนยัน และ log ปิดงานไม่มี actor', async () => {
    const withConfirmer: unknown[] = await ds.query(
      `SELECT 1 FROM tickets WHERE close_reason = 'auto_closed' AND confirmed_by IS NOT NULL`,
    );
    const withActor: unknown[] = await ds.query(
      `SELECT 1 FROM tickets t JOIN ticket_status_logs l ON l.ticket_id = t.id AND l.to_status = 'closed'
       WHERE t.close_reason = 'auto_closed' AND l.actor_id IS NOT NULL`,
    );
    expect(withConfirmer).toHaveLength(0);
    expect(withActor).toHaveLength(0);
  });

  it('technician ทุกคนไม่มีห้อง และมีผู้ใช้ครบ 4 role', async () => {
    const housedTechs: unknown[] = await ds.query(
      `SELECT 1 FROM users WHERE role = 'technician' AND room_id IS NOT NULL`,
    );
    const roles: { role: UserRole }[] = await ds.query(`SELECT DISTINCT role FROM users ORDER BY role`);
    expect(housedTechs).toHaveLength(0);
    expect(roles.map((r) => r.role)).toEqual(['student', 'technician', 'staff', 'admin']);
  });

  // TRANSITIONS รู้แค่ role — ใครยืนยันใบไหนได้ขึ้นกับ scope ด้วย (กฎข้อ 2) จึงต้องตรวจแยก
  it('ใบที่ปิดแล้ว: ห้องพักยืนยันโดยนักศึกษาในห้องนั้น ส่วนกลางโดย staff ระบบปิดเองไม่มีผู้ยืนยัน', async () => {
    const bad: unknown[] = await ds.query(
      `SELECT 1 FROM tickets t LEFT JOIN users u ON u.id = t.confirmed_by
       WHERE t.status = 'closed' AND NOT CASE t.close_reason
         WHEN 'auto_closed'     THEN t.confirmed_by IS NULL
         WHEN 'user_confirmed'  THEN t.scope = 'room' AND u.role = 'student' AND u.room_id = t.room_id
         WHEN 'staff_confirmed' THEN t.scope = 'common_area' AND u.role = 'staff'
       END`,
    );
    expect(bad).toHaveLength(0);
  });

  it('ใบห้องพักที่ช่างเริ่มงานแล้ว ต้องได้รับอนุญาตเข้าห้องหรือมีนัด', async () => {
    const bad: unknown[] = await ds.query(
      `SELECT 1 FROM tickets t
       WHERE t.scope = 'room' AND NOT t.permission_to_enter AND t.scheduled_at IS NULL
         AND EXISTS (SELECT 1 FROM ticket_status_logs l WHERE l.ticket_id = t.id AND l.to_status = 'in_progress')`,
    );
    expect(bad).toHaveLength(0);
  });

  it('ticket_counters ตามทันเลขใบสูงสุดของปี พ.ศ. นั้น', async () => {
    const beYear = thaiBuddhistYear(now);
    const [row]: { last_no: number; used: string }[] = await ds.query(
      `SELECT c.last_no, (SELECT count(*) FROM tickets WHERE ticket_no LIKE 'TK-' || c.be_year || '-%') AS used
       FROM ticket_counters c WHERE c.be_year = $1`,
      [beYear],
    );
    expect(row.last_no).toBe(Number(row.used));
  });
});
