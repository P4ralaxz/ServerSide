import 'dotenv/config';
import { uiDatabaseUrl } from './ui-db';

// ต้อง import ก่อน AppModule: ConfigModule.forRoot ตรวจและเก็บ env ตอนโหลดไฟล์ app.module
// ค่าใน process.env ชนะค่าใน .env จึงชี้ ui-server ไปที่ DB ของเทสได้โดยไม่แตะไฟล์ .env
// เก็บ URL เดิมไว้ให้ ensureUiDatabase ใช้ต่อ Postgres ตัวเดียวกันเพื่อสร้าง dorm_ui
export const BASE_DATABASE_URL = process.env.DATABASE_URL ?? '';
process.env.DATABASE_URL = uiDatabaseUrl(BASE_DATABASE_URL);
