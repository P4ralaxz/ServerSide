import '../../src/common/time/utc';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // สุ่มใหม่ทุกครั้งที่รันเทส — ไม่มีค่า secret เขียนค้างไว้ใน repo แม้จะเป็นค่าของเทส
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.OTP_SECRET = randomBytes(32).toString('hex');
  process.env.JWT_EXPIRES_IN = '8h';
  process.env.WEB_DIST_DIR = writeWebFixture();

  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL));
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();
}

// build ปลอมของหน้าเว็บ — เทสฝั่ง Nest ตรวจแค่การเสิร์ฟ /app (ไม่ผ่าน guard, ทุก path ได้ index.html, API ไม่เปลี่ยน)
// จึงไม่ต้องรอ web:build ก่อนรัน test:e2e · หน้าเว็บจริงเทสด้วย Playwright บน web/dist
export const WEB_FIXTURE_INDEX =
  '<!doctype html><title>fixture</title><div id="root"></div><script type="module" src="/app/assets/index.js"></script>';
const writeWebFixture = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dorm-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), WEB_FIXTURE_INDEX);
  writeFileSync(join(dir, 'assets', 'index.js'), 'console.log("fixture")');
  return dir;
};
