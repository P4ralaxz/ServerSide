import { expect, test } from '@playwright/test';
import { openTicketOfOtherRoom, sessionFor, signIn } from './support';

// สแกน asset ห้องอื่น → ไม่เห็นใบของห้องนั้น ไม่มีปุ่มแจ้ง (UI-PLAN 9)
// mutation check: /scan ส่ง open_ticket ของห้องอื่นออกมา → เทสนี้ต้องแดง
test('สแกนครุภัณฑ์ของห้องอื่น: ไม่เห็นใบของห้องนั้น และไม่มีปุ่มแจ้งซ่อม', async ({ page, request }) => {
  const { ticket, outsider, qrToken } = await openTicketOfOtherRoom(request);
  await signIn(page, await sessionFor(request, outsider.email));

  await page.goto(`/app/scan/${qrToken}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ticket.asset.name);
  await expect(page.getByText('แจ้งซ่อมได้เฉพาะผู้พักห้องนั้น')).toBeVisible();

  await expect(page.getByText(ticket.ticket_no)).toHaveCount(0);
  await expect(page.getByText('สถานะล่าสุด')).toHaveCount(0);
  for (const name of [
    'แจ้งซ่อมชิ้นนี้',
    'ดูสถานะ',
    'ดูและยืนยันผลซ่อม',
    'เจอปัญหาเดียวกัน',
    'แจ้งซ่อมชิ้นอื่นในห้องนี้',
  ]) {
    await expect(page.getByRole('link', { name })).toHaveCount(0);
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
});

// UI-PLAN 6: 404 แสดงข้อความเดียวกันทั้ง "ไม่มีใบ" และ "ไม่มีสิทธิ์ดู"
// ถ้าต่างกัน คนไล่เปิด id จะรู้ว่าใบไหนมีอยู่จริง แม้ API ตอบ 404 เหมือนกัน
// mutation check: แสดงข้อความ 404 ต่างกันสองกรณี → เทสนี้ต้องแดง
test('เปิดใบของห้องอื่น กับเปิดใบที่ไม่มีจริง ได้หน้าเดียวกันทุกตัวอักษร', async ({ page, request }) => {
  const { ticket, outsider } = await openTicketOfOtherRoom(request);
  await signIn(page, await sessionFor(request, outsider.email));

  const pageText = async (id: string) => {
    await page.goto(`/app/tickets/${id}`);
    await expect(page.getByText('ไม่พบใบนี้ หรือคุณไม่มีสิทธิ์ดู')).toBeVisible();
    return page.locator('main').innerText();
  };
  const hidden = await pageText(ticket.id);
  const missing = await pageText('00000000-0000-4000-8000-000000000000');
  expect(hidden).toBe(missing);
  await expect(page.getByText(ticket.asset.name)).toHaveCount(0);
});
