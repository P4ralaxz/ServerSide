import '../common/time/utc';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../database/data-source';

// npm run user:make-admin -- you@kmitl.ac.th
// ตั้งบัญชีของอีเมลนี้เป็น admin (สร้างใหม่ถ้ายังไม่มี) — ใช้ตอนเปิดให้คนอื่นใช้ผ่าน tunnel
// ที่บัญชีเดโมรับรหัสทางอีเมลไม่ได้ (อีเมลไม่มีจริง) admin คนแรกจึงต้องตั้งจากเครื่องที่ต่อ DB ได้
// เป็นสคริปต์บนเครื่อง ไม่ใช่ endpoint: ถ้าเป็น endpoint ใครก็ตามที่เข้าถึงแอปได้จะตั้งตัวเองเป็น admin ได้
const UNIVERSITY_EMAIL = /^[^@\s]+@kmitl\.ac\.th$/;

export const makeAdmin = async (ds: DataSource, raw: string): Promise<{ id: string; created: boolean }> => {
  // normalize แบบเดียวกับ IsUniversityEmail — ไม่งั้น login ด้วยตัวพิมพ์ต่างกันแล้วหาบัญชีไม่เจอ
  const email = raw.trim().toLowerCase();
  if (!UNIVERSITY_EMAIL.test(email)) throw new Error('ต้องเป็นอีเมล @kmitl.ac.th');
  return ds.transaction(async (m) => {
    const updated: [{ id: string }[], number] = await m.query(
      `UPDATE users SET role = 'admin', is_active = true
        WHERE email = $1 AND deleted_at IS NULL
        RETURNING id`,
      [email],
    );
    if (updated[0].length > 0) return { id: updated[0][0].id, created: false };
    const [row]: { id: string }[] = await m.query(`INSERT INTO users (email, role) VALUES ($1, 'admin') RETURNING id`, [
      email,
    ]);
    return { id: row.id, created: true };
  });
};

const main = async (): Promise<void> => {
  const email = process.argv[2];
  if (!email) throw new Error('ใส่อีเมล: npm run user:make-admin -- you@kmitl.ac.th');
  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL ?? ''));
  await ds.initialize();
  try {
    const r = await makeAdmin(ds, email);
    console.log(r.created ? `สร้างบัญชี admin ให้ ${email} แล้ว` : `ตั้ง ${email} เป็น admin แล้ว`);
  } finally {
    await ds.destroy();
  }
};

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
