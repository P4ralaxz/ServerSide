import { expect, test, type Page } from '@playwright/test';
import { sessionFor, STAFF, type Session } from './support';

// ปุ่มออกจากระบบ — ล้าง session ของแท็บแล้วกลับหน้า login
// mutation check: logout() ไม่เรียก clearSession → เปิดหน้าเดิมแล้วไม่ถูกส่งไป login → เทสนี้ต้องแดง

const SESSION_KEY = 'dorm.session';
const STUDENT = 'demo.s0001@kmitl.ac.th';

// ใส่ session ครั้งเดียว — signIn() ใน support ใช้ addInitScript ที่ใส่ซ้ำทุกครั้งที่โหลดหน้า
// ซึ่งจะทำให้ออกจากระบบแล้วกลับมา login เองตอนหน้า login โหลดใหม่
const signInOnce = async (page: Page, s: Session): Promise<void> => {
  await page.goto('/app/login');
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [SESSION_KEY, JSON.stringify(s)]);
};

const storedSession = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);

test('นักศึกษาออกจากระบบ: กดยกเลิกแล้วยังอยู่หน้าเดิม · ยืนยันแล้ว session หาย และเปิดหน้าเดิมต้อง login ใหม่', async ({
  page,
  request,
}) => {
  await signInOnce(page, await sessionFor(request, STUDENT));
  await page.goto('/app/tickets');
  await expect(page.getByRole('heading', { name: 'ส่งซ่อมแล้ว' })).toBeVisible();
  const logout = page.getByRole('button', { name: 'ออกจากระบบ' });

  page.once('dialog', (d) => void d.dismiss());
  await logout.click();
  await expect(page).toHaveURL(/\/app\/tickets$/);
  expect(await storedSession(page)).not.toBeNull();

  page.once('dialog', (d) => void d.accept());
  await logout.click();
  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByLabel('อีเมล')).toBeVisible();
  expect(await storedSession(page)).toBeNull();

  // กด back / เปิดลิงก์เดิม → ต้องไม่เห็นใบของคนก่อน แต่ถูกส่งไปหน้า login พร้อม next
  await page.goto('/app/tickets');
  await expect(page).toHaveURL(/\/app\/login\?next=%2Fapp%2Ftickets$/);
});

test('ช่างและ Staff มีปุ่มออกจากระบบบนหัวหน้าจอ และกดแล้วกลับหน้า login', async ({ page, request }) => {
  for (const [email, path] of [
    ['demo.tech1@kmitl.ac.th', '/app/jobs'],
    [STAFF, '/app/queue'],
    [STAFF, '/app/reports'],
  ] as const) {
    await signInOnce(page, await sessionFor(request, email));
    await page.goto(path);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
    await expect(page, path).toHaveURL(/\/app\/login$/);
    expect(await storedSession(page)).toBeNull();
  }
});
