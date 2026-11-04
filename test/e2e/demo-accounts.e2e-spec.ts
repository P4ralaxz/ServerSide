import { DataSource } from 'typeorm';
import { DEMO_ACCOUNTS, ensureDemoAccounts } from '../../src/cli/demo-accounts';
import { makeBuilding, makeRoom, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

// npm run user:demo — บัญชีทดลองทุกบทบาทบน DB ที่ใช้งานจริง ด้วยอีเมล +แท็ก ของเจ้าของเครื่อง
// mutation check:
//   ไม่เช็คห้องเต็ม → นักศึกษาเดโมถูกผูกห้องที่มีคนครบแล้ว เทส "ห้องแรกที่ยังว่าง" แดง
//   รันซ้ำแล้วแก้บทบาทกลับ → เทส "ไม่เขียนทับ" แดง
describe('user:demo', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
  });
  beforeEach(async () => {
    await truncateAll(ds);
  });

  it('สร้างครบทุกบทบาทด้วยอีเมล +แท็ก · นักศึกษาสองคนอยู่ห้องแรกที่ยังว่าง ข้ามห้องที่เต็ม', async () => {
    const b = await makeBuilding(ds, 'D1');
    const full = await makeRoom(ds, b, '301', 1);
    await makeUser(ds, { roomId: full });
    await makeRoom(ds, b, '302', 2);

    const rows = await ensureDemoAccounts(ds, ' Me@KMITL.ac.th ');
    expect(rows.map((r) => r.email)).toEqual(DEMO_ACCOUNTS.map((a) => `me+${a.tag}@kmitl.ac.th`));
    expect(new Set(rows.map((r) => r.role))).toEqual(new Set(['student', 'technician', 'staff', 'admin']));
    expect(rows.every((r) => r.created)).toBe(true);
    expect(rows.filter((r) => r.role === 'student').map((r) => r.room)).toEqual(['D1-302', 'D1-302']);
    expect(rows.filter((r) => r.role !== 'student').every((r) => r.room === null)).toBe(true);
  });

  it('ไม่มีห้องว่าง → นักศึกษาเดโมถูกสร้างแบบยังไม่มีห้อง (ไม่ยัดเกินความจุ)', async () => {
    const b = await makeBuilding(ds, 'D1');
    const room = await makeRoom(ds, b, '301', 1);
    await makeUser(ds, { roomId: room });
    const rows = await ensureDemoAccounts(ds, 'me@kmitl.ac.th');
    expect(rows.filter((r) => r.role === 'student').map((r) => r.room)).toEqual([null, null]);
    expect((await ds.query(`SELECT count(*)::int AS n FROM users WHERE room_id = $1`, [room]))[0].n).toBe(1);
  });

  it('รันซ้ำไม่สร้างซ้ำ และไม่เขียนทับบทบาทที่ admin เปลี่ยนไปแล้ว', async () => {
    await ensureDemoAccounts(ds, 'me@kmitl.ac.th');
    await ds.query(`UPDATE users SET role = 'staff' WHERE email = 'me+tech1@kmitl.ac.th'`);
    const again = await ensureDemoAccounts(ds, 'me@kmitl.ac.th');
    expect(again.every((r) => !r.created)).toBe(true);
    expect(again.find((r) => r.email === 'me+tech1@kmitl.ac.th')?.role).toBe('staff');
    expect((await ds.query(`SELECT count(*)::int AS n FROM users`))[0].n).toBe(DEMO_ACCOUNTS.length);
  });

  it.each(['someone@gmail.com', 'me+x@kmitl.ac.th', ''])('อีเมลฐานไม่ถูกต้อง (%p) → ปฏิเสธ', async (email) => {
    await expect(ensureDemoAccounts(ds, email)).rejects.toThrow('@kmitl.ac.th');
  });
});
