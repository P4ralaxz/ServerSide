import '../src/common/time/utc';
import { Test } from '@nestjs/testing';
import { AbstractLoader, ExpressLoader } from '@nestjs/serve-static';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/modules/auth/mail.service';
import { FakeMailService } from './setup/app';

// backend จริงสำหรับ Playwright (npm run web:e2e) — DB ของ dev ที่ seed ใหม่ + หน้าเว็บจาก web/dist
// ต่างจากของจริงที่เดียว: MailService เป็นตัวปลอมที่เขียนรหัส OTP ลงไฟล์ ให้เทสอ่านแทนการเปิดกล่องเมล
// จึงไม่ต้องมี endpoint สำหรับเทส (ที่ถ้าหลุดไปถึงเครื่องจริงจะเป็นช่องให้ login เป็นใครก็ได้)
const port = Number(process.env.UI_PORT ?? 3199);
const mailFile = process.env.UI_MAIL_FILE;
if (!mailFile) throw new Error('ต้องตั้ง UI_MAIL_FILE');

class FileMailService extends FakeMailService {
  override sendLoginCode(email: string, code: string): Promise<void> {
    mkdirSync(dirname(mailFile!), { recursive: true });
    let codes: Record<string, string> = {};
    try {
      codes = JSON.parse(readFileSync(mailFile!, 'utf8')) as Record<string, string>;
    } catch {
      // ไฟล์ยังไม่มี
    }
    codes[email] = code;
    writeFileSync(mailFile!, JSON.stringify(codes));
    return super.sendLoginCode(email, code);
  }
}

void (async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(new FileMailService())
    // เหตุผลเดียวกับ createTestApp: TestingModule สร้าง provider ก่อนมี http adapter
    .overrideProvider(AbstractLoader)
    .useValue(new ExpressLoader())
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(port);
  console.log(`ui-server พร้อมที่ http://localhost:${port}/app/`);
})();
