import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().min(1),
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
