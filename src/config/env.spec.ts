import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'j'.repeat(32),
  OTP_SECRET: 'o'.repeat(32),
};

describe('validateEnv — ค่าเมลเซิร์ฟเวอร์', () => {
  it('ไม่ตั้งค่า SMTP ใหม่เลย = ค่าของ dev เดิม (Mailpit)', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({ SMTP_HOST: 'localhost', MAILPIT_SMTP_PORT: 1026, SMTP_SECURE: false });
    expect(env.SMTP_PORT).toBeUndefined();
    expect(env.SMTP_USER).toBeUndefined();
  });

  it('อ่านค่าจาก env เป็นตัวเลข / boolean', () => {
    const env = validateEnv({ ...base, SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'a', SMTP_PASS: 'b' });
    expect(env).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true, SMTP_USER: 'a', SMTP_PASS: 'b' });
  });

  // ตั้งครึ่งเดียว = พิมพ์ผิด — ต้องล้มตอนเปิดแอป ไม่ใช่ส่งแบบไม่มี auth แล้วเมลหายเงียบ ๆ
  it.each([{ SMTP_USER: 'a' }, { SMTP_PASS: 'b' }])(
    'ตั้ง SMTP_USER / SMTP_PASS ไม่ครบคู่ %j → เปิดแอปไม่ขึ้น',
    (half) => {
      expect(() => validateEnv({ ...base, ...half })).toThrow('ต้องตั้ง SMTP_USER และ SMTP_PASS คู่กัน');
    },
  );

  it('SMTP_SECURE รับแค่ true / false', () => {
    expect(() => validateEnv({ ...base, SMTP_SECURE: 'yes' })).toThrow('SMTP_SECURE');
  });
});
