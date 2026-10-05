import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../src/database/data-source';

// connection ตรงเข้า DB ของเทส สำหรับเตรียมข้อมูลและตรวจผลโดยไม่ผ่านแอป
export const openTestDb = async (): Promise<DataSource> => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('ไม่มี DATABASE_URL — ต้องรันผ่าน npm run test:e2e (global-setup เป็นคนตั้งค่า)');
  return new DataSource(dataSourceOptions(url)).initialize();
};

// TRUNCATE เร็วกว่าสร้าง DB ใหม่มาก — อ่านชื่อตารางจาก DB เอง ตารางที่เพิ่มใน migration ถัดไปจะถูกล้างด้วยโดยไม่ต้องมาแก้ที่นี่
export const truncateAll = async (ds: DataSource): Promise<void> => {
  const rows: { tablename: string }[] = await ds.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (rows.length === 0) return;
  await ds.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
};
