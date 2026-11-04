import '../src/common/time/utc';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source';
import { seed } from '../src/database/seed/seed';

// DB ของ Playwright (npm run web:e2e) — แยกจาก DB ใน DATABASE_URL ที่คนอื่นใช้งานผ่าน tunnel
// ทุกรอบเทส seed ใหม่ทั้งก้อน ถ้าใช้ DB เดียวกัน บัญชีที่ admin ตั้งบทบาทไว้และใบที่คนอื่นแจ้งจะหายทุกครั้งที่รันเทส
// อยู่บน Postgres ตัวเดียวกัน (container เดิม) ต่างกันที่ชื่อ database — ไม่ต้องเปิด container เพิ่ม
export const UI_DB_NAME = 'dorm_ui';

export const uiDatabaseUrl = (base: string): string => {
  if (!base) throw new Error('ไม่มี DATABASE_URL ใน .env');
  const url = new URL(base);
  url.pathname = `/${UI_DB_NAME}`;
  return url.toString();
};

// สร้าง database (ครั้งแรก) + migration — ui-server เรียกก่อนต่อ DB
// เพราะ Playwright เปิด webServer ก่อน global-setup: ถ้ารอ global-setup สร้าง server จะต่อ DB ที่ยังไม่มีแล้วล้ม
export const ensureUiDatabase = async (base: string): Promise<string> => {
  const url = uiDatabaseUrl(base);
  const admin = new DataSource({ type: 'postgres', url: base });
  await admin.initialize();
  try {
    const found: unknown[] = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [UI_DB_NAME]);
    // CREATE DATABASE ใช้ parameter ไม่ได้ — ชื่อเป็นค่าคงที่ในไฟล์นี้ ไม่ได้มาจากภายนอก
    if (found.length === 0) await admin.query(`CREATE DATABASE ${UI_DB_NAME}`);
  } finally {
    await admin.destroy();
  }
  const ds = new DataSource(dataSourceOptions(url));
  await ds.initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
  return url;
};

// seed ใหม่ทั้งก้อน — เรียกจาก global-setup ของ Playwright ทุกรอบ
const main = async (): Promise<void> => {
  const ds = new DataSource(dataSourceOptions(await ensureUiDatabase(process.env.DATABASE_URL ?? '')));
  await ds.initialize();
  try {
    console.log(`seed ${UI_DB_NAME} เสร็จ`, await seed(ds));
  } finally {
    await ds.destroy();
  }
};

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
