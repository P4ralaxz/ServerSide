import { INestApplication, Type } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AbstractLoader, ExpressLoader } from '@nestjs/serve-static';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { MailService, ReopenedMailInfo } from '../../src/modules/auth/mail.service';

interface ResolvedMailRecord {
  email: string;
  ticketNo: string;
  note: string | null;
  autoCloseAt: Date | null;
  link: string;
  where: string;
}

// ตัวแทน MailService ใน e2e: ไม่ส่งเมลจริง เก็บรหัสไว้ให้เทสอ่านแทนการเปิดกล่องเมล
export class FakeMailService {
  outbox: { email: string; code: string }[] = [];
  // เมลแจ้งผลซ่อม (DESIGN 6.10) — เทสเช็คว่าผู้รับถูกคน และไม่มีเมลออกเมื่อทรานแซกชัน rollback
  resolvedOutbox: ResolvedMailRecord[] = [];
  // เมลตอนผู้พักส่งใบกลับ (DESIGN 6.10 สัปดาห์ 5) — ผู้รับคือช่างเจ้าของงาน + staff
  reopenedOutbox: (ReopenedMailInfo & { email: string })[] = [];
  // ตั้งเพื่อจำลอง SMTP ล่ม / ค้าง
  mode: 'ok' | 'fail' | 'hang' = 'ok';
  // hook ตอนเมลออก — ใช้ตรวจว่าเมลถูกส่ง "หลัง commit" จริง โดยอ่าน DB จาก connection อื่นในจังหวะนั้น
  onSend?: () => Promise<void> | void;

  sendLoginCode(email: string, code: string): Promise<void> {
    this.outbox.push({ email, code });
    return this.result();
  }

  async sendTicketResolved(email: string, info: Omit<ResolvedMailRecord, 'email'>): Promise<void> {
    this.resolvedOutbox.push({ email, ...info });
    await this.onSend?.();
    return this.result();
  }

  async sendTicketReopened(email: string, info: ReopenedMailInfo): Promise<void> {
    this.reopenedOutbox.push({ email, ...info });
    await this.onSend?.();
    return this.result();
  }

  reopenedRecipients(): string[] {
    return this.reopenedOutbox.map((m) => m.email).sort();
  }

  last(): string {
    const entry = this.outbox.at(-1);
    if (!entry) throw new Error('ยังไม่มีเมลถูกส่ง');
    return entry.code;
  }

  resolvedRecipients(): string[] {
    return this.resolvedOutbox.map((m) => m.email).sort();
  }

  reset(): void {
    this.outbox = [];
    this.resolvedOutbox = [];
    this.reopenedOutbox = [];
    this.mode = 'ok';
    this.onSend = undefined;
  }

  private result(): Promise<void> {
    if (this.mode === 'fail') return Promise.reject(new Error('SMTP ล่ม (จำลอง)'));
    if (this.mode === 'hang') return new Promise(() => undefined);
    return Promise.resolve();
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
    // TestingModule สร้าง provider ก่อนมี http adapter → factory ของ serve-static เลือก NoopLoader แล้ว /app ไม่ถูกเสิร์ฟ
    // NestFactory.create ของจริงมี adapter ก่อนจึงได้ ExpressLoader อยู่แล้ว — ตัวนี้ register ตอน onModuleInit ซึ่งมี adapter แล้ว
    .overrideProvider(AbstractLoader)
    .useValue(new ExpressLoader())
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
