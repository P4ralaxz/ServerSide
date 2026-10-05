import { INestApplication, Type } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MailService } from '../../src/modules/auth/mail.service';

// ตัวแทน MailService ใน e2e: ไม่ส่งเมลจริง เก็บรหัสไว้ให้เทสอ่านแทนการเปิดกล่องเมล
export class FakeMailService {
  outbox: { email: string; code: string }[] = [];
  // ตั้งเพื่อจำลอง SMTP ล่ม / ค้าง
  mode: 'ok' | 'fail' | 'hang' = 'ok';

  sendLoginCode(email: string, code: string): Promise<void> {
    this.outbox.push({ email, code });
    if (this.mode === 'fail') return Promise.reject(new Error('SMTP ล่ม (จำลอง)'));
    if (this.mode === 'hang') return new Promise(() => undefined);
    return Promise.resolve();
  }

  last(): string {
    const entry = this.outbox.at(-1);
    if (!entry) throw new Error('ยังไม่มีเมลถูกส่ง');
    return entry.code;
  }

  reset(): void {
    this.outbox = [];
    this.mode = 'ok';
  }
}

export interface TestApp {
  app: INestApplication;
  mail: FakeMailService;
}

// แอปตัวเดียวกับของจริง (pipe / filter / guard ชุดเดียวกันผ่าน AppModule + configureApp) ต่อกับ Postgres ของ Testcontainers
// extraControllers ใช้เฉพาะเทสที่ต้องมี endpoint จำลอง
export const createTestApp = async (extraControllers: Type[] = []): Promise<TestApp> => {
  const mail = new FakeMailService();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  // เปิดพอร์ตสุ่มครั้งเดียว: ถ้าปล่อยให้ supertest เปิดเองทุก request เทสที่ยิงพร้อมกันจะผูก listener ซ้อนกันบน server ตัวเดียว
  await app.listen(0);
  return { app, mail };
};

// token ของ user ที่มีอยู่ใน DB โดยไม่ต้องเดิน flow OTP ทุกเทส — เซ็นด้วย JwtService ตัวเดียวกับแอป
export const tokenFor = (app: INestApplication, userId: string): Promise<string> =>
  app.get(JwtService).signAsync({ sub: userId });

export const bearer = async (app: INestApplication, userId: string): Promise<{ Authorization: string }> => ({
  Authorization: `Bearer ${await tokenFor(app, userId)}`,
});

// ตัวนับของ throttler อยู่ในหน่วยความจำของแอป — ล้างก่อนแต่ละเทส ไม่งั้นเทสท้ายไฟล์จะโดน 429 จากเทสก่อนหน้า
export const resetThrottle = (app: INestApplication): void => {
  // storage ตัวในหน่วยความจำของ @nestjs/throttler เก็บสองที่ ต้องล้างทั้งคู่ ไม่งั้นจำนวนครั้งเดิมถูกนับกลับมา
  const storage = app.get(ThrottlerStorage) as unknown as {
    storage: Map<string, unknown>;
    hitExpirations: Map<string, unknown>;
  };
  storage.storage.clear();
  storage.hitExpirations.clear();
};
