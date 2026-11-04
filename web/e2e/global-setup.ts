import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// ทุกรอบเริ่มจากข้อมูลเดโมชุดเดียวกัน — seed ล้าง login_codes ด้วย ตัวนับขอรหัสถี่ (ต่ออีเมล / ต่อ IP) จึงเริ่มใหม่ทุกรอบ
// seed ลง DB แยกของเทส (test/ui-db.ts) ไม่ใช่ DB ใน .env ที่ใช้งานจริง — ไม่งั้นรันเทสแล้วข้อมูลของคนอื่นหาย
export default function globalSetup(): void {
  if (!existsSync(resolve('dist/index.html'))) {
    throw new Error('ไม่พบ web/dist — รัน npm run web:build ก่อน npm run web:e2e');
  }
  rmSync(resolve('e2e/.tmp'), { recursive: true, force: true });
  execSync('npx ts-node test/ui-db.ts', { cwd: resolve('..'), stdio: 'inherit' });
}
