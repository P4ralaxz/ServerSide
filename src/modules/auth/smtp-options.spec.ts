import { smtpOptions } from './smtp-options';

const dev = {
  SMTP_HOST: 'localhost',
  SMTP_PORT: undefined,
  MAILPIT_SMTP_PORT: 1026,
  SMTP_SECURE: false,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
};

describe('smtpOptions — ค่าที่ MailService ใช้ต่อเมลเซิร์ฟเวอร์', () => {
  it('dev ไม่ตั้งอะไรเพิ่ม: ส่งเข้า Mailpit แบบไม่มี auth เหมือนเดิม', () => {
    const o = smtpOptions(dev);
    expect(o).toMatchObject({ host: 'localhost', port: 1026, secure: false, requireTLS: false });
    expect(o.auth).toBeUndefined();
  });

  it('เมลเซิร์ฟเวอร์จริงพอร์ต 587: ใส่ auth และบังคับ STARTTLS — รหัสผ่านต้องไม่ออกไปแบบไม่เข้ารหัส', () => {
    const o = smtpOptions({ ...dev, SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 587, SMTP_USER: 'a@b.c', SMTP_PASS: 'x' });
    expect(o).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'a@b.c', pass: 'x' },
    });
  });

  it('พอร์ต 465 (SMTP_SECURE=true): TLS ตั้งแต่ต่อ ไม่ต้อง STARTTLS ซ้ำ', () => {
    const o = smtpOptions({ ...dev, SMTP_PORT: 465, SMTP_SECURE: true, SMTP_USER: 'a', SMTP_PASS: 'b' });
    expect(o).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it('SMTP_PORT ไม่ตั้ง → ใช้ MAILPIT_SMTP_PORT · ตั้งแล้วใช้ค่าที่ตั้ง', () => {
    expect(smtpOptions(dev).port).toBe(1026);
    expect(smtpOptions({ ...dev, SMTP_PORT: 2525 }).port).toBe(2525);
  });

  it('มี timeout ทุกช่วง — SMTP ค้างต้องไม่ค้าง connection ไว้ตลอด', () => {
    const o = smtpOptions(dev);
    expect(o.connectionTimeout).toBeGreaterThan(0);
    expect(o.greetingTimeout).toBeGreaterThan(0);
    expect(o.socketTimeout).toBeGreaterThan(0);
  });
});
