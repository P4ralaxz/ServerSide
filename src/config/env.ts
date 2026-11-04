import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3100),
    DATABASE_URL: z.string().min(1),

    // สองค่านี้ต้องเป็นคนละตัว: ถ้า secret ของ JWT หลุด คนที่ได้ dump ของ login_codes ต้องยัง brute-force รหัส 6 หลักไม่ได้
    JWT_SECRET: z.string().min(32),
    OTP_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('8h'),

    SMTP_HOST: z.string().default('localhost'),
    // dev ส่งเข้า Mailpit — ใช้ตัวแปรเดียวกับที่ docker-compose ใช้เปิดพอร์ต จะได้ไม่ต้องแก้สองที่
    MAILPIT_SMTP_PORT: z.coerce.number().int().positive().default(1026),
    // เมลเซิร์ฟเวอร์จริง (เปิดให้คนอื่นใช้ผ่าน tunnel / cloud) — ไม่ตั้ง = ส่งเข้า Mailpit แบบเดิม
    // SMTP_PORT ไม่ตั้ง = ใช้ MAILPIT_SMTP_PORT · SMTP_SECURE=true สำหรับพอร์ต 465 · ตั้ง USER แล้วต้องตั้ง PASS ด้วย
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    MAIL_FROM: z.string().default('ระบบแจ้งซ่อมหอพัก <no-reply@kmitl.ac.th>'),
    // ใช้ต่อเป็นลิงก์ในอีเมลแจ้งผลซ่อม (DESIGN 6.10) — เมลต้องพาผู้พักกลับมาที่ใบได้จริง
    APP_BASE_URL: z.string().default('http://localhost:3100'),

    // 72 = 3 วันตามกฎข้อ 2 — อยู่ใน env เพื่อย่อลงตอนซ้อมเดโมได้โดยไม่แก้โค้ด
    AUTO_CLOSE_AFTER_HOURS: z.coerce.number().positive().default(72),
    AUTO_CLOSE_CRON_ENABLED: bool.default(false),

    // ไฟล์ build ของหน้าเว็บ (UI-PLAN 7) — ไม่ระบุ = web/dist ของ repo · e2e ชี้ไปโฟลเดอร์ทดสอบได้โดยไม่ต้อง build ก่อน
    WEB_DIST_DIR: z.string().min(1).optional(),

    // เปิดเมื่อรันหลัง tunnel / reverse proxy บนเครื่องเดียวกัน (cloudflared, ngrok)
    // ไม่เปิด = ทุก request ดูเหมือนมาจาก 127.0.0.1 แล้วโควตาต่อ IP (ขอรหัส / ยืนยันรหัส / throttler) ถูกใช้ร่วมกันทั้งระบบ
    TRUST_PROXY: bool.default(false),
  })
  // ตั้งแค่ครึ่งเดียวคือพิมพ์ผิด — ถ้าปล่อยผ่าน แอปจะส่งแบบไม่มี auth แล้วเซิร์ฟเวอร์จริงปฏิเสธทุกฉบับโดยไม่มีใครรู้
  .refine((e) => (e.SMTP_USER === undefined) === (e.SMTP_PASS === undefined), {
    message: 'ต้องตั้ง SMTP_USER และ SMTP_PASS คู่กัน',
    path: ['SMTP_PASS'],
  });

export type Env = z.infer<typeof schema>;

// ใช้กับ ConfigModule.forRoot({ validate }) — env ผิดให้ล้มตอนเปิดแอป ไม่ใช่ตอนมี request แรก
export const validateEnv = (raw: Record<string, unknown>): Env => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`ค่า env ไม่ถูกต้อง\n${lines.join('\n')}`);
  }
  return parsed.data;
};
