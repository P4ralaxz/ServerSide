import 'dotenv/config';
import { createTransport } from 'nodemailer';
import { validateEnv } from '../config/env';
import { smtpOptions } from '../modules/auth/smtp-options';

// npm run mail:test -- you@kmitl.ac.th
// ลองต่อเมลเซิร์ฟเวอร์ด้วยค่าใน .env ชุดเดียวกับแอป แล้วส่งเมลทดสอบหนึ่งฉบับ
// ใช้ตอนตั้งค่าเมลจริงครั้งแรก — ถ้าส่งไม่ผ่าน OTP ของผู้ใช้ก็ไม่ผ่านเหมือนกัน แต่แอปไม่บอกใคร (ไม่รอผลการส่งโดยเจตนา)
const main = async (): Promise<void> => {
  const to = process.argv[2];
  if (!to) throw new Error('ใส่อีเมลผู้รับ: npm run mail:test -- you@kmitl.ac.th');
  const env = validateEnv(process.env);
  const options = smtpOptions(env);
  // ไม่พิมพ์รหัสผ่าน — log ของ terminal อาจถูกแปะต่อในที่อื่น
  console.log(
    `ต่อ ${options.host}:${options.port} secure=${options.secure} requireTLS=${options.requireTLS} auth=${options.auth ? 'มี' : 'ไม่มี'}`,
  );
  const transport = createTransport(options);
  await transport.verify();
  console.log('ต่อเมลเซิร์ฟเวอร์ได้และ login ผ่าน');
  const info = await transport.sendMail({
    from: env.MAIL_FROM,
    to,
    subject: 'ทดสอบการส่งเมลของระบบแจ้งซ่อมหอพัก',
    text: 'ถ้าได้รับเมลนี้ แปลว่ารหัส OTP จะส่งถึงผู้ใช้ได้',
  });
  console.log(`ส่งแล้ว: ${info.messageId} · ตอบรับ ${info.accepted.length} ปฏิเสธ ${info.rejected.length}`);
};

main().catch((e: unknown) => {
  console.error(`ส่งไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
