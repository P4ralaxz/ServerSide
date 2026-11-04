import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { Env } from '../../config/env';

type SmtpEnv = Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'MAILPIT_SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASS'>;

// ค่าของ nodemailer ที่เดียว — MailService และ npm run mail:test ใช้ฟังก์ชันนี้ตัวเดียวกัน
// ถ้าสคริปต์ทดสอบตั้งค่าเอง จะส่งผ่านได้ทั้งที่แอปจริงส่งไม่ผ่าน
//
// dev: ไม่ตั้ง SMTP_USER → ส่งเข้า Mailpit (localhost:MAILPIT_SMTP_PORT) แบบไม่มี auth เหมือนเดิม
// ใช้จริง: ตั้ง SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS ของผู้ให้บริการเมล
//   SMTP_SECURE=true = TLS ตั้งแต่ต่อ (พอร์ต 465) · false = ต่อแล้วค่อยขึ้น STARTTLS (พอร์ต 587)
export const smtpOptions = (env: SmtpEnv): SMTPTransport.Options => {
  const auth = env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? env.MAILPIT_SMTP_PORT,
    secure: env.SMTP_SECURE,
    // มีรหัสผ่านแต่ไม่ได้ต่อแบบ TLS ตั้งแต่แรก → บังคับ STARTTLS
    // ถ้าเซิร์ฟเวอร์ไม่รองรับ ให้ส่งไม่สำเร็จดีกว่าส่งรหัสผ่าน SMTP ออกไปแบบไม่เข้ารหัส
    requireTLS: auth !== undefined && !env.SMTP_SECURE,
    ...(auth ? { auth } : {}),
    // SMTP ค้างต้องไม่ลาก request ไปด้วย — OtpService ไม่รอผลการส่งอยู่แล้ว แต่ connection ที่ค้างยังกินทรัพยากร
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
};
