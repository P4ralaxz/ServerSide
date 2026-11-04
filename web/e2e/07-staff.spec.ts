import { expect, test, type Page } from '@playwright/test';
import { allOpenTickets, sessionFor, signIn, STAFF } from './support';

// เส้นทาง UI-2 ของ Staff (UI-PLAN 9)

const chipCount = async (page: Page, label: string): Promise<number> => {
  const chip = page.getByRole('group', { name: 'กรองคิว' }).getByRole('button', { name: new RegExp(label) });
  await expect(chip.locator('b')).toHaveText(/^\d+$/);
  return Number(await chip.locator('b').textContent());
};

// มอบหมายใบจากตัวกรอง "รอมอบหมาย" → ตัวเลขลดลง → ช่างเห็นงาน
// mutation check: ตัวเลข "รอมอบหมาย" ไม่ลดลงหลังมอบหมาย → เทสนี้ต้องแดง
test('มอบหมายจากตัวกรองรอมอบหมาย: ตัวเลขลดลงทันที และช่างที่ได้งานเห็นงานในงานของฉัน', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  await signIn(page, await sessionFor(request, STAFF));
  await page.goto('/app/queue');
  await page
    .getByRole('group', { name: 'กรองคิว' })
    .getByRole('button', { name: /รอมอบหมาย/ })
    .click();
  await expect(page).toHaveURL(/filter=unassigned/);

  const before = await chipCount(page, 'รอมอบหมาย');
  expect(before).toBeGreaterThan(0);
  const rows = page.locator('tbody tr[tabindex]');
  // ตัวเลขบนชิปเท่ากับจำนวนแถวของตัวกรองนั้น (queue-counts กับ GET /tickets ใช้เงื่อนไขชุดเดียวกัน)
  await expect(rows).toHaveCount(before);

  const first = rows.first();
  const ticketNo = (await first.locator('.tno').textContent())!;
  await first.click();
  const panel = page.getByRole('complementary', { name: 'รายละเอียดใบที่เลือก' });
  await expect(panel.getByText(ticketNo)).toBeVisible();
  await panel.getByLabel('เลือกช่าง').selectOption({ label: 'อนุชา ทองดี' });
  await panel.getByRole('button', { name: 'มอบหมาย', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('มอบหมายให้ช่างอนุชาแล้ว');
  await expect.poll(() => chipCount(page, 'รอมอบหมาย')).toBe(before - 1);
  await expect(rows).toHaveCount(before - 1);
  await expect(panel.getByRole('button', { name: 'เปลี่ยนช่าง' })).toBeVisible();

  const ctx = await browser.newContext({ baseURL, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const techPage = await ctx.newPage();
  await signIn(techPage, await sessionFor(request, 'demo.tech3@kmitl.ac.th'));
  await techPage.goto('/app/jobs');
  await expect(techPage.getByRole('link', { name: new RegExp(ticketNo) })).toBeVisible();
  await ctx.close();
});

// Staff เปิดใบห้องพักที่รอยืนยัน → ไม่มีปุ่มยืนยัน (กฎข้อ 2) · ใบส่วนกลางที่รอยืนยันมีปุ่ม (คู่เทียบ)
// เปิดผ่าน /app/tickets/:id ซึ่งเป็นลิงก์ในอีเมลของ Staff → ต้องไปที่คิวพร้อมเลือกใบนั้น
// mutation check: Staff เห็นปุ่มยืนยันบนใบห้องพักที่ resolved → เทสนี้ต้องแดง
test('ใบห้องพักที่รอยืนยัน: Staff ไม่มีปุ่มยืนยันและเห็นเหตุผล · ใบส่วนกลางมีปุ่ม', async ({ page, request }) => {
  const open = await allOpenTickets(request);
  const room = open.find((t) => t.status === 'resolved' && t.room_id !== null);
  const common = open.find((t) => t.status === 'resolved' && t.room_id === null);
  expect(room && common, 'seed ต้องมีใบรอยืนยันทั้งห้องพักและส่วนกลาง').toBeTruthy();
  await signIn(page, await sessionFor(request, STAFF));

  await page.goto(`/app/tickets/${room!.id}`);
  await expect(page).toHaveURL(new RegExp(`/app/queue\\?ticket=${room!.id}`));
  const panel = page.getByRole('complementary', { name: 'รายละเอียดใบที่เลือก' });
  await expect(panel.getByText(room!.ticket_no)).toBeVisible();
  await expect(panel.getByText('Staff ยืนยันใบห้องพักแทนไม่ได้')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'ยืนยันว่าหายแล้ว' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'ส่งกลับให้ช่าง' })).toHaveCount(0);

  await page.goto(`/app/queue?ticket=${common!.id}`);
  await expect(panel.getByText(common!.ticket_no)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'ยืนยันว่าหายแล้ว' })).toBeVisible();
  await expect(panel.getByText('Staff ยืนยันใบห้องพักแทนไม่ได้')).toHaveCount(0);
});
