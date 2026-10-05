import '../../src/common/time/utc';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../src/database/data-source';

// Postgres 16 จริงหนึ่งตัวต่อการรันเทสทั้งชุด — partial index / CHECK / lock ทดสอบบน SQLite ไม่ได้
// โครงสร้างมาจาก migration ตัวเดียวกับที่ใช้จริง ไม่ใช่ synchronize
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  (globalThis as { __PG__?: StartedPostgreSqlContainer }).__PG__ = container;

  // worker ของ jest ถูก fork หลังจุดนี้ จึงได้ env ชุดนี้ไปด้วย
  // ตั้งทุกค่าที่แอปต้องใช้ที่นี่ — เทสต้องรันได้บนเครื่องที่ไม่มีไฟล์ .env และไม่ขึ้นกับค่าในไฟล์นั้น
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789';
  process.env.OTP_SECRET = 'test-otp-secret-fedcba9876543210fedcba9876';
  process.env.JWT_EXPIRES_IN = '8h';

  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL));
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();
}
