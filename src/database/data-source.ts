import '../common/time/utc';
import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';
import { Init1759622400000 } from './migrations/1759622400000-init';
import { TechnicianNoRoom1759708800000 } from './migrations/1759708800000-technician-no-room';

export const dataSourceOptions = (url: string): DataSourceOptions => ({
  type: 'postgres',
  url,
  // ห้ามเปิด: synchronize สร้างตารางที่ดูเหมือนถูก แต่ partial index / trigger / view / CHECK หายไปเงียบ ๆ
  synchronize: false,
  migrationsRun: false,
  entities: ALL_ENTITIES,
  migrations: [Init1759622400000, TechnicianNoRoom1759708800000],
  // ตรึงโซนของ session ด้วย กันกรณี now() / date_trunc ใน SQL คิดตามโซนของเซิร์ฟเวอร์ DB
  extra: { options: '-c timezone=UTC' },
});

// ใช้โดย typeorm CLI (npm run migration:run)
export default new DataSource(dataSourceOptions(process.env.DATABASE_URL ?? ''));
