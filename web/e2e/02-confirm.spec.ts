import { expect, test } from '@playwright/test';
import { awaitingConfirm, sessionFor, signIn } from './support';

// ใบที่รอผู้พักยืนยัน: อยู่กลุ่ม "รอคุณยืนยัน" และมีปุ่มยืนยัน — ทั้งสองอย่างมาจาก 'confirm' ใน actions ของ API
// mutation check (UI-PLAN 9): ลบ 'confirm' ออกจาก actions ฝั่ง API แล้วเทสนี้ต้องแดง
test('รอคุณยืนยัน → หายแล้ว ปิดใบ → ใบย้ายไปปิดแล้ว', async ({ page, request }) => {
  const fx = await awaitingConfirm(request, 1);
  await signIn(page, await sessionFor(request, fx.student.email));

  await page.goto('/app/tickets');
  const waiting = page.getByRole('region', { name: 'รอคุณยืนยัน' });
  const row = waiting.getByRole('link', { name: new RegExp(fx.ticket.ticket_no) });
  await expect(row).toBeVisible();
  // ตัวเลขบนแท็บ = ใบที่ยังเปิดอยู่
  await expect(page.getByRole('navigation', { name: 'เมนู' }).locator('.badge')).toHaveText(/\d+/);

  await row.click();
  await page.getByRole('button', { name: 'หายแล้ว ปิดใบ' }).click();
  const sheet = page.getByRole('dialog', { name: 'ยืนยันว่าหายแล้ว' });
  await sheet.getByRole('button', { name: 'ยืนยัน ปิดใบ' }).click();

  await expect(page.getByRole('status')).toHaveText('ปิดใบแล้ว ขอบคุณที่ยืนยัน');
  await expect(page.locator('.card .pill').first()).toHaveText('ปิดแล้ว');
  await expect(page.getByRole('button', { name: 'หายแล้ว ปิดใบ' })).toHaveCount(0);

  await page.getByRole('link', { name: 'ส่งซ่อมแล้ว' }).click();
  await expect(
    page.getByRole('region', { name: 'ปิดแล้ว' }).getByRole('link', { name: new RegExp(fx.ticket.ticket_no) }),
  ).toBeVisible();
  await expect(waiting.getByRole('link', { name: new RegExp(fx.ticket.ticket_no) })).toHaveCount(0);
});
