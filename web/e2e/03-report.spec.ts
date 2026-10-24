import { expect, test } from '@playwright/test';
import { awaitingConfirm, expectNoHorizontalOverflow, reporterWithMixedRoom, sessionFor, signIn } from './support';

// เส้นทาง UI-1 (UI-PLAN 9): แจ้งซ่อมชิ้นใหม่ — ชิ้นที่มีใบเปิดเลือกไม่ได้ · ไม่กรอกอาการต้องโดนบล็อก
// → หน้าสำเร็จ → ส่งซ่อมแล้ว
test('แจ้งซ่อม: ชิ้นที่มีใบเปิดอยู่เลือกไม่ได้ · ไม่กรอกอาการโดนบล็อก · ส่งแล้วขึ้นใน "กำลังดำเนินการ"', async ({
  page,
  request,
}) => {
  const avoid = [(await awaitingConfirm(request, 2)).ticket.room_id!];
  const { student, openTicket } = await reporterWithMixedRoom(request, avoid);
  await signIn(page, await sessionFor(request, student.email));

  await page.goto('/app/report');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^แจ้งซ่อม ห้อง /);
  const list = page.getByRole('list', { name: 'ครุภัณฑ์' });

  // ชิ้นที่มีใบเปิดอยู่: แสดงสถานะแทนช่องติ๊ก กดแล้วไปดูใบนั้น (ไม่ใช่ปุ่มเลือก)
  const taken = list.getByRole('link', { name: new RegExp(`${openTicket.asset.name}.*แจ้งไว้แล้ว`) });
  await expect(taken).toBeVisible();
  await expect(list.getByRole('button', { name: new RegExp(`^${openTicket.asset.name}`) })).toHaveCount(0);
  await expect(taken).toHaveAttribute('href', `/app/tickets/${openTicket.id}`);

  // ยังไม่เลือก → ปุ่มส่งกดไม่ได้
  await expect(page.getByRole('button', { name: 'เลือกอย่างน้อย 1 ชิ้น' })).toBeDisabled();

  // locator ด้วย pressed:false จะเลื่อนไปชิ้นถัดไปหลังกด — ล็อกด้วยชื่อของชิ้นที่เลือก
  const freeName = (await list.getByRole('button', { pressed: false }).first().locator('.t').textContent())!;
  const free = list.getByRole('button', { name: new RegExp(`^${freeName}`) });
  await free.click();
  await expect(free).toHaveAttribute('aria-pressed', 'true');

  // ไม่กรอกอาการ → บล็อกที่ฟอร์ม ไม่มีคำขอไปที่ API
  let posted = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/tickets') posted++;
  });
  await page.getByRole('button', { name: 'ส่งแจ้งซ่อม 1 รายการ' }).click();
  await expect(page.getByText('บอกอาการสั้น ๆ ให้ช่างเตรียมของได้ถูก')).toBeVisible();
  await expect(page.getByLabel('อาการ')).toHaveAttribute('aria-invalid', 'true');
  expect(posted).toBe(0);
  await expectNoHorizontalOverflow(page);

  await page.getByLabel('อาการ').fill('ใช้งานไม่ได้ตั้งแต่เมื่อคืน');
  await page.getByRole('button', { name: 'ส่งแจ้งซ่อม 1 รายการ' }).click();

  await expect(page.getByText('ส่งแจ้งซ่อมแล้ว')).toBeVisible();
  const created = page.getByRole('list', { name: 'ใบที่สร้าง' }).getByRole('link');
  await expect(created).toHaveCount(1);
  await expect(created).toContainText(freeName);
  await expect(created).toContainText('รอมอบหมาย');
  const ticketNo = (await created.locator('.num').textContent())!;
  expect(ticketNo).toMatch(/^TK-\d{4}-\d{6}$/);
  expect(posted).toBe(1);

  await page.getByRole('link', { name: 'ดูรายการที่ส่งซ่อมแล้ว' }).click();
  await expect(page).toHaveURL(/\/app\/tickets$/);
  await expect(
    page.getByRole('region', { name: 'กำลังดำเนินการ' }).getByRole('link', { name: new RegExp(ticketNo) }),
  ).toBeVisible();
});
