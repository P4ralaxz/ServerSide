import { expect, test } from '@playwright/test';
import { awaitingConfirm, codeFor, expectNoHorizontalOverflow, rememberSession } from './support';

// เส้นทาง UI-1 (UI-PLAN 9): login → หน้าสแกนของชิ้นที่มีใบรอยืนยัน → ดูและยืนยันผลซ่อม → ยังไม่หาย
// ส่งโดยไม่กรอกต้องโดนบล็อก แล้วกรอกส่ง → ใบกลับไปหาช่างคนเดิม
test('สแกน QR ก่อน login → login ด้วยรหัสทางอีเมล → กลับมาหน้าสแกน → ส่งกลับให้ช่าง', async ({ page, request }) => {
  const fx = await awaitingConfirm(request, 0);
  // ประโยคบนจอใช้ชื่อต้นของช่าง (ต้นแบบ: "ส่งกลับให้ช่างสมชายแล้ว")
  const tech = fx.ticket.assignee!.name!.split(' ')[0];

  // QR ชี้ไปที่ /app/scan/:qrToken — ยังไม่ login จึงถูกพาไปหน้า login พร้อมจำหน้าที่จะกลับ
  await page.goto(`/app/scan/${fx.qrToken}`);
  await expect(page).toHaveURL(/\/app\/login\?next=/);
  await expect(page.getByText('คุณสแกน QR ครุภัณฑ์ในหอพัก')).toBeVisible();

  await page.getByLabel('อีเมล').fill(fx.student.email);
  await page.getByRole('button', { name: 'ส่งรหัสทางอีเมล' }).click();
  const otp = page.getByLabel('รหัส 6 หลัก');
  await expect(otp).toBeVisible();
  // ช่องเดียว ให้มือถือเติมรหัสจากอีเมลอัตโนมัติได้ (UI-PLAN 5)
  await expect(otp).toHaveAttribute('inputmode', 'numeric');
  await expect(otp).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(otp).toHaveAttribute('maxlength', '6');

  const code = await codeFor(fx.student.email);
  // รหัสผิด → บอกจำนวนครั้งที่เหลือใต้ช่อง (attempts_left จาก API)
  await otp.fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'ยืนยันรหัส' }).click();
  await expect(page.getByText('รหัสไม่ถูกต้อง ลองได้อีก 4 ครั้ง')).toBeVisible();

  await otp.fill(code);
  await page.getByRole('button', { name: 'ยืนยันรหัส' }).click();

  // หน้าแรกหลังสแกน: การ์ดครุภัณฑ์ + สถานะล่าสุด + ปุ่มหลักตาม actions ของใบ
  await expect(page).toHaveURL(new RegExp(`/app/scan/${fx.qrToken}$`));
  await rememberSession(page, fx.student.email);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(fx.ticket.asset.name);
  await expect(page.getByText(fx.ticket.ticket_no)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'ดูและยืนยันผลซ่อม' }).click();

  await expect(page).toHaveURL(new RegExp(`/app/tickets/${fx.ticket.id}$`));
  await expect(page.getByText(/ระบบจะปิดใบให้/)).toBeVisible();
  await page.getByRole('button', { name: 'ยังไม่หาย' }).click();

  const sheet = page.getByRole('dialog', { name: 'ยังไม่หาย' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(`ใบจะกลับไปหาช่าง${tech}คนเดิม`)).toBeVisible();

  // ส่งโดยไม่กรอก → ฟอร์มบล็อก ไม่มีคำขอไปที่ API และใบยังรอยืนยันอยู่
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/reopen')) posted = true;
  });
  await sheet.getByRole('button', { name: 'ส่งกลับให้ช่าง' }).click();
  await expect(sheet.getByText('บอกอาการก่อนส่งกลับ ช่างจะได้รู้ว่าต้องแก้ตรงไหน')).toBeVisible();
  await expect(sheet.getByLabel('เล่าอาการที่ยังเป็นอยู่')).toHaveAttribute('aria-invalid', 'true');
  expect(posted).toBe(false);

  await sheet.getByLabel('เล่าอาการที่ยังเป็นอยู่').fill('ยังมีน้ำหยดตอนปิดก๊อกสุด');
  await sheet.getByRole('button', { name: 'ส่งกลับให้ช่าง' }).click();

  await expect(page.getByRole('status')).toHaveText(`ส่งกลับให้ช่าง${tech}แล้ว`);
  await expect(sheet).toBeHidden();
  await expect(page.getByText('มอบหมายแล้ว').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'หายแล้ว ปิดใบ' })).toHaveCount(0);
  await expect(page.getByText('"ยังมีน้ำหยดตอนปิดก๊อกสุด"')).toBeVisible();
});
