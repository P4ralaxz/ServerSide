import { expect, test } from '@playwright/test';
import { allOpenTickets, pickOnce, sessionFor, signIn, studentOfRoom, technicianOf } from './support';

// เส้นทาง UI-2 ของช่าง (UI-PLAN 9)

// ใบที่ผู้พักส่งกลับขึ้นกลุ่ม "ถูกส่งกลับ" ของช่างคนเดิมพร้อมเหตุผล
// mutation check: ช่างเห็นงานของช่างคนอื่นใน "งานของฉัน" → เทสนี้ต้องแดง (ทุกแถวต้องเป็นงานของช่างคนนี้)
test('งานที่ถูกส่งกลับอยู่บนสุดพร้อมเหตุผล · งานของฉันมีแต่งานของตัวเอง', async ({ page, request }) => {
  const returned = await pickOnce(request, 'returned-room', (all) =>
    all.find((t) => t.status === 'assigned' && t.reopen_count > 0 && t.room_id !== null),
  );
  const tech = await technicianOf(request, returned);
  await signIn(page, await sessionFor(request, tech.email));

  await page.goto('/app/jobs');
  const group = page.getByRole('region', { name: 'ถูกส่งกลับ' });
  const row = group.getByRole('link', { name: new RegExp(returned.ticket_no) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`"${returned.last_reopen_note}"`);
  // กลุ่มแรกของหน้าคือ "ถูกส่งกลับ"
  await expect(page.locator('main section').first()).toHaveAttribute('aria-label', 'ถูกส่งกลับ');

  const mine = new Set(
    (await allOpenTickets(request)).filter((t) => t.assigned_to === tech.id).map((t) => t.ticket_no),
  );
  const shown = await page.locator('main a.li .s .num').allTextContents();
  expect(shown.length).toBeGreaterThan(0);
  for (const no of shown) expect(mine, `${no} ไม่ใช่งานของ ${tech.email}`).toContain(no);
  expect(shown.length).toBe(mine.size);

  await row.click();
  await expect(page.getByText(`ถูกส่งกลับครั้งที่ ${returned.reopen_count}`)).toBeVisible();
});

// รออะไหล่โดยไม่กรอกต้องโดนบล็อก แล้วกรอกส่ง → ชื่ออะไหล่ขึ้นในรายการ (waiting_for_parts)
test('รออะไหล่: ไม่กรอกชื่ออะไหล่โดนบล็อก · กรอกแล้วขึ้นกลุ่มรออะไหล่พร้อมชื่ออะไหล่', async ({ page, request }) => {
  const job = await pickOnce(
    request,
    'parts',
    (all) =>
      all.find((t) => t.status === 'in_progress' && t.room_id === null) ?? all.find((t) => t.status === 'in_progress'),
  );
  const tech = await technicianOf(request, job);
  await signIn(page, await sessionFor(request, tech.email));

  await page.goto(`/app/jobs/${job.id}`);
  await page.getByRole('button', { name: 'รออะไหล่' }).click();
  const sheet = page.getByRole('dialog', { name: 'รออะไหล่' });

  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/status')) posted = true;
  });
  await sheet.getByRole('button', { name: 'บันทึก' }).click();
  await expect(sheet.getByText('บอกชื่ออะไหล่ที่รอ Staff จะได้ช่วยตาม')).toBeVisible();
  await expect(sheet.getByLabel('รออะไหล่อะไร')).toHaveAttribute('aria-invalid', 'true');
  expect(posted).toBe(false);

  await sheet.getByLabel('รออะไหล่อะไร').fill('วาล์วก๊อก ขนาด 1/2 นิ้ว');
  await sheet.getByRole('button', { name: 'บันทึก' }).click();
  await expect(page.getByRole('status')).toHaveText('บันทึกว่ารออะไหล่แล้ว');
  await expect(page.locator('.card .pill').first()).toHaveText('รออะไหล่');
  await expect(page.getByRole('button', { name: 'อะไหล่มาแล้ว ซ่อมต่อ' })).toBeVisible();

  await page.goto('/app/jobs');
  const row = page.getByRole('region', { name: 'รออะไหล่' }).getByRole('link', { name: new RegExp(job.ticket_no) });
  await expect(row).toContainText('วาล์วก๊อก ขนาด 1/2 นิ้ว');
});

// ช่างซ่อมเสร็จ → ใบย้ายไป "รอผู้พักยืนยัน" และนักศึกษาเห็นใน "รอคุณยืนยัน"
test('ซ่อมเสร็จ: ช่างปิดเองไม่ได้ · ใบไปอยู่ "รอผู้พักยืนยัน" และนักศึกษาเห็นใน "รอคุณยืนยัน"', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const job = await pickOnce(request, 'resolve', (all) =>
    all.find((t) => t.status === 'in_progress' && t.room_id !== null),
  );
  const tech = await technicianOf(request, job);
  await signIn(page, await sessionFor(request, tech.email));

  await page.goto(`/app/jobs/${job.id}`);
  await page.getByRole('button', { name: 'ซ่อมเสร็จ' }).click();
  const sheet = page.getByRole('dialog', { name: 'แจ้งว่าซ่อมเสร็จ' });
  await expect(sheet.getByText('ผู้พักเป็นคนปิดใบ')).toBeVisible();
  await sheet.getByLabel('ทำอะไรไปบ้าง (ไม่บังคับ)').fill('เปลี่ยนซีลยาง ทดสอบแล้วไม่รั่ว');
  await sheet.getByRole('button', { name: 'ยืนยันซ่อมเสร็จ' }).click();

  await expect(page.getByRole('status')).toHaveText('ส่งให้ผู้พักยืนยันแล้ว');
  await expect(page.getByText('คุณปิดใบเองไม่ได้')).toBeVisible();
  for (const name of ['เริ่มงาน', 'ซ่อมเสร็จ', 'รออะไหล่', 'อะไหล่มาแล้ว ซ่อมต่อ']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }

  await page.goto('/app/jobs');
  await expect(
    page.getByRole('region', { name: 'รอผู้พักยืนยัน' }).getByRole('link', { name: new RegExp(job.ticket_no) }),
  ).toBeVisible();

  const student = await studentOfRoom(request, job.room_id!);
  const ctx = await browser.newContext({ baseURL, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const studentPage = await ctx.newPage();
  await signIn(studentPage, await sessionFor(request, student.email));
  await studentPage.goto('/app/tickets');
  await expect(
    studentPage.getByRole('region', { name: 'รอคุณยืนยัน' }).getByRole('link', { name: new RegExp(job.ticket_no) }),
  ).toBeVisible();
  await ctx.close();
});
