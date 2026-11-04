import { expect, test, type Page } from '@playwright/test';
import type { UserView } from '../src/api/schema.gen';
import { newPage, shoot, type Variant } from './screens';
import { allOpenTickets, apiGet, sessionFor, signIn, STAFF, technicianOf } from './support';

// หน้าจัดการผู้ใช้ของ admin — กฎอยู่ที่ API หน้านี้แสดงผลและ error ตาม code
// mutation check:
//   UsersRoute ปล่อยให้ staff เข้า → เทส "staff ไม่มีเมนูผู้ใช้" แดง
//   ไม่ปิด select บทบาทในแถวของตัวเอง → เทสแรกแดง
//   เปลี่ยนนักศึกษาที่มีห้องเป็นช่างโดยไม่ถอดห้อง → API ตอบ 400 เทสแรกแดง

const ADMIN = 'demo.admin@kmitl.ac.th';

const rowOf = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email });

const userByEmail = async (page: Page, email: string): Promise<UserView> => {
  const staff = await sessionFor(page.request, STAFF);
  const [u] = await apiGet<UserView[]>(page.request, staff, `/users?email=${encodeURIComponent(email)}`);
  return u;
};

test('admin: แถวของตัวเองแก้ไม่ได้ · ผูกห้องให้นักศึกษา · เปลี่ยนนักศึกษาที่มีห้องเป็นช่าง แล้วถูกถอดออกจากห้อง', async ({
  page,
  request,
}) => {
  await signIn(page, await sessionFor(request, ADMIN));
  await page.goto('/app/queue');
  await page.getByRole('navigation', { name: 'เมนู' }).getByRole('link', { name: 'ผู้ใช้' }).click();
  await expect(page).toHaveURL(/\/app\/users$/);

  const own = rowOf(page, ADMIN);
  await expect(own.getByLabel(`บทบาทของ ${ADMIN}`)).toBeDisabled();
  await expect(own.getByRole('button')).toHaveCount(0);

  // นักศึกษายังไม่มีห้อง → ผูกห้องแรกที่ยังว่าง
  const s13 = 'demo.s0013@kmitl.ac.th';
  const roomSelect = rowOf(page, s13).getByLabel(`ห้องพักของ ${s13}`);
  await expect(roomSelect).toHaveValue('');
  const free = (await roomSelect.locator('option:not([disabled]):not([value=""])').first().getAttribute('value'))!;
  await roomSelect.selectOption(free);
  await expect(page.getByRole('status')).toContainText('ผูก');
  await expect(roomSelect).toHaveValue(free);
  expect((await userByEmail(page, s13)).room_id).toBe(free);

  // นักศึกษาคนเดิม (มีห้องแล้ว) → ช่าง: ต้องถอดห้องในคำขอเดียวกัน ไม่งั้น API ไม่รับ
  await rowOf(page, s13).getByLabel(`บทบาทของ ${s13}`).selectOption('technician');
  const dialog = page.getByRole('alertdialog', { name: 'เปลี่ยนบทบาท' });
  await expect(dialog).toContainText('ถอดออกจากห้องพัก');
  await dialog.getByRole('button', { name: 'เปลี่ยนบทบาท' }).click();
  await expect(page.getByRole('status')).toHaveText(/^เปลี่ยน .+ เป็นช่างแล้ว$/);
  await expect(rowOf(page, s13).getByLabel(`ห้องพักของ ${s13}`)).toHaveCount(0);
  const after = await userByEmail(page, s13);
  expect(after.role).toBe('technician');
  expect(after.room_id).toBeNull();
});

test('admin: ระงับช่างที่ยังมีงานค้างไม่ได้ — เห็นเลขใบที่ค้าง และบัญชียังใช้งานอยู่', async ({ page, request }) => {
  const [ticket] = (await allOpenTickets(request)).filter((t) => t.assigned_to);
  const tech = await technicianOf(request, ticket);

  await signIn(page, await sessionFor(request, ADMIN));
  await page.goto('/app/users');
  await rowOf(page, tech.email)
    .getByRole('button', { name: `ระงับ ${tech.email}` })
    .click();
  await page.getByRole('alertdialog', { name: 'ระงับบัญชี' }).getByRole('button', { name: 'ระงับบัญชี' }).click();

  await expect(page.getByRole('alert')).toContainText('ยังมีงานค้าง');
  await expect(page.getByRole('alert')).toContainText(ticket.ticket_no);
  await expect(rowOf(page, tech.email).getByText('ใช้งาน', { exact: true })).toBeVisible();
  expect((await userByEmail(page, tech.email)).is_active).toBe(true);
});

test('admin: เพิ่มบัญชีช่างล่วงหน้า · อีเมลซ้ำบอกใต้ช่องอีเมล', async ({ page, request }) => {
  const email = `new.tech.${Date.now()}@kmitl.ac.th`;
  await signIn(page, await sessionFor(request, ADMIN));
  await page.goto('/app/users');

  const form = page.locator('form', { has: page.getByRole('heading', { name: 'เพิ่มบัญชี' }) });
  await form.getByLabel('อีเมล @kmitl.ac.th').fill(email);
  await form.getByLabel('ชื่อ (ไม่บังคับ)').fill('ช่างใหม่ ทดสอบ');
  await form.getByLabel('บทบาท').selectOption('technician');
  await form.getByRole('button', { name: 'เพิ่มบัญชี' }).click();
  await expect(page.getByRole('status')).toHaveText(`เพิ่มบัญชี ${email} แล้ว`);
  await expect(rowOf(page, email).getByLabel(`บทบาทของ ${email}`)).toHaveValue('technician');

  await form.getByLabel('อีเมล @kmitl.ac.th').fill(email);
  await form.getByRole('button', { name: 'เพิ่มบัญชี' }).click();
  await expect(form.getByRole('alert')).toHaveText('อีเมลนี้มีบัญชีอยู่แล้ว');
});

test('staff ไม่มีเมนูผู้ใช้ และเปิด /app/users ตรง ๆ แล้วกลับคิวงาน', async ({ page, request }) => {
  await signIn(page, await sessionFor(request, STAFF));
  await page.goto('/app/queue');
  await expect(page.getByRole('navigation', { name: 'เมนู' }).getByRole('link', { name: 'รายงาน' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'เมนู' }).getByRole('link', { name: 'ผู้ใช้' })).toHaveCount(0);
  await page.goto('/app/users');
  await expect(page).toHaveURL(/\/app\/queue$/);
});

const VARIANTS: Variant[] = [
  { width: 360, height: 780, scheme: 'light' },
  { width: 1280, height: 860, scheme: 'light' },
  { width: 1280, height: 860, scheme: 'dark' },
];
for (const v of VARIANTS) {
  test(`screenshot หน้าผู้ใช้ ${v.width}px ${v.scheme}`, async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, v, await sessionFor(request, ADMIN));
    await page.goto('/app/users');
    await expect(rowOf(page, ADMIN)).toBeVisible();
    await shoot(page, '27-admin-users', v);
    await page.context().close();
  });
}
