import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
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
  MAIL_FROM: z.string().default('ระบบแจ้งซ่อมหอพัก <no-reply@kmitl.ac.th>'),

  // 72 = 3 วันตามกฎข้อ 2 — อยู่ใน env เพื่อย่อลงตอนซ้อมเดโมได้โดยไม่แก้โค้ด
  AUTO_CLOSE_AFTER_HOURS: z.coerce.number().positive().default(72),
  AUTO_CLOSE_CRON_ENABLED: bool.default(false),
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
