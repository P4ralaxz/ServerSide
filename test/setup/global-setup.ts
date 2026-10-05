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
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.NODE_ENV = 'test';

  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL));
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();
}
