import { DataSource } from 'typeorm';
import { makeAdmin } from '../../src/cli/make-admin';
import { makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

// npm run user:make-admin — admin คนแรกตอนเปิดให้คนอื่นใช้ผ่าน tunnel (บัญชีเดโมรับรหัสทางอีเมลไม่ได้)
describe('user:make-admin', () => {
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

  const userOf = async (id: string) =>
    (await ds.query(`SELECT email, role, is_active FROM users WHERE id = $1`, [id]))[0] as Record<string, unknown>;

  it('อีเมลที่ยังไม่มีบัญชี → สร้างเป็น admin (ตัดช่องว่าง + ตัวเล็กเหมือนตอน login)', async () => {
    const r = await makeAdmin(ds, '  Me@KMITL.ac.th ');
    expect(r.created).toBe(true);
    expect(await userOf(r.id)).toEqual({ email: 'me@kmitl.ac.th', role: 'admin', is_active: true });
  });

  it('บัญชีที่มีอยู่แล้ว (รวมที่ถูกระงับ) → เปลี่ยนเป็น admin และเปิดใช้ ไม่สร้างซ้ำ', async () => {
    const id = await makeUser(ds, { email: 'me@kmitl.ac.th' });
    await ds.query(`UPDATE users SET is_active = false WHERE id = $1`, [id]);
    const r = await makeAdmin(ds, 'me@kmitl.ac.th');
    expect(r).toEqual({ id, created: false });
    expect(await userOf(id)).toMatchObject({ role: 'admin', is_active: true });
    expect((await ds.query(`SELECT count(*)::int AS n FROM users`))[0].n).toBe(1);
  });

  it('บัญชีที่ถูกลบแบบ soft ไม่ถูกปลุก — สร้างบัญชีใหม่แทน', async () => {
    const old = await makeUser(ds, { email: 'me@kmitl.ac.th' });
    await ds.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [old]);
    const r = await makeAdmin(ds, 'me@kmitl.ac.th');
    expect(r.created).toBe(true);
    expect(r.id).not.toBe(old);
  });

  it.each(['someone@gmail.com', 'x@student.kmitl.ac.th', ''])(
    'ไม่ใช่อีเมล @kmitl.ac.th (%p) → ปฏิเสธ',
    async (email) => {
      await expect(makeAdmin(ds, email)).rejects.toThrow('@kmitl.ac.th');
    },
  );
});
