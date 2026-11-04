import { expect, test } from '@playwright/test';
import { newPage, shoot, type Variant } from './screens';
import { sessionFor, signIn, STAFF } from './support';

// หน้าพิมพ์ QR ของ Staff (สัปดาห์ 6) — ทั้งห้องในแผ่นเดียว QR ยังเป็นของครุภัณฑ์ทีละชิ้น
// mutation check: QrRoute ปล่อยให้นักศึกษาเข้า → เทส "คนที่ไม่ใช่ Staff" แดง

const STUDENT = 'demo.s0001@kmitl.ac.th';

test('Staff เลือกห้องจากเมนูพิมพ์ QR → เห็นสติกเกอร์ทุกชิ้นของห้องพร้อมรูป QR · โหมดพิมพ์ซ่อนเมนู', async ({
  page,
  request,
}) => {
  await signIn(page, await sessionFor(request, STAFF));
  await page.goto('/app/queue');
  await page.getByRole('navigation', { name: 'เมนู' }).getByRole('link', { name: 'พิมพ์ QR' }).click();
  await expect(page).toHaveURL(/\/app\/qr$/);
  await expect(page.getByRole('button', { name: /^พิมพ์/ })).toBeDisabled();

  const qrCalls: string[] = [];
  page.on('response', (r) => {
    if (/\/assets\/[^/]+\/qr$/.test(r.url())) qrCalls.push(`${r.status()} ${r.headers()['content-type']}`);
  });
  await page.getByLabel('ห้อง / ส่วนกลาง').selectOption({ label: 'D1 ห้อง 301' });
  await expect(page).toHaveURL(/place=room%3A/);

  const sheet = page.getByRole('list', { name: 'QR ของ D1 ห้อง 301' });
  const stickers = sheet.getByRole('listitem');
  const n = await stickers.count();
  expect(n).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: `พิมพ์ ${n} ชิ้น` })).toBeEnabled();
  // ทุกชิ้นมีรูป QR ที่โหลดสำเร็จ (โหลดพร้อม token — img ธรรมดาส่ง Authorization ไม่ได้)
  await expect(sheet.getByRole('img')).toHaveCount(n);
  for (const img of await sheet.getByRole('img').all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  expect(qrCalls).toHaveLength(n);
  expect(new Set(qrCalls)).toEqual(new Set(['200 image/png']));
  await expect(stickers.first()).toContainText('D1 ห้อง 301');
  await expect(stickers.first()).toContainText('D1-301-');

  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'เมนู' })).toBeHidden();
  await expect(page.getByLabel('ห้อง / ส่วนกลาง')).toBeHidden();
  await expect(sheet).toBeVisible();
});

test('ส่วนกลางของอาคาร: เฉพาะครุภัณฑ์ส่วนกลาง', async ({ page, request }) => {
  await signIn(page, await sessionFor(request, STAFF));
  await page.goto('/app/qr');
  await page.getByLabel('ห้อง / ส่วนกลาง').selectOption({ label: 'D2 ส่วนกลาง' });
  const stickers = page.getByRole('list', { name: 'QR ของ D2 ส่วนกลาง' }).getByRole('listitem');
  await expect(stickers.first()).toBeVisible();
  for (const code of await stickers.locator('.num').allTextContents()) expect(code).toMatch(/^D2-CM-/);
  // รอรูปครบก่อนจบเทส — ปิดหน้าระหว่างโหลดทำให้ฝั่ง API log ว่าส่งรูปไม่ได้ (ผู้ขอตัดการเชื่อมต่อไปก่อน)
  await expect(stickers.getByRole('img')).toHaveCount(await stickers.count());
  for (const img of await stickers.getByRole('img').all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
});

test('คนที่ไม่ใช่ Staff เปิด /app/qr ตรง ๆ แล้วกลับหน้าแรกของตัวเอง', async ({ page, request }) => {
  await signIn(page, await sessionFor(request, STUDENT));
  await page.goto('/app/qr');
  await expect(page).toHaveURL(/\/app\/report$/);
});

for (const v of [
  { width: 1280, height: 860, scheme: 'light' },
  { width: 1280, height: 860, scheme: 'dark' },
] as Variant[]) {
  test(`screenshot หน้าพิมพ์ QR ${v.width}px ${v.scheme}`, async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, v, await sessionFor(request, STAFF));
    await page.goto('/app/qr');
    await page.getByLabel('ห้อง / ส่วนกลาง').selectOption({ label: 'D1 ห้อง 301' });
    const imgs = page.getByRole('list', { name: /^QR ของ/ }).getByRole('img');
    await expect(imgs.first()).toBeVisible();
    for (const img of await imgs.all()) {
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    }
    await shoot(page, '30-qr-sheet', v);
    if (v.scheme === 'light') {
      // แผ่นที่ออกเครื่องพิมพ์จริง — A4 กว้างราว 794px ที่ 96 dpi
      await page.emulateMedia({ media: 'print' });
      await shoot(page, '30-qr-print', { ...v, width: 794 });
    }
    await page.context().close();
  });
}
