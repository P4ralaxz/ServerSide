import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssetListItemView, BuildingView, RoomView, TicketView } from '../src/api/schema.gen';
import { newPage } from './screens';
import { apiGet, codeFor, rememberSession, sessionFor, STAFF, type Session } from './support';

// เส้นทางเดโมตาม docs/demo.md ลำดับเดียวกับที่นำเสนอ (สัปดาห์ 6) — ถ้าไฟล์นี้ผ่าน แปลว่าไล่ตามเอกสารได้จนจบ
// โดยไม่ต้องแก้ข้อมูลด้วยมือ · seed ใหม่ก่อนเริ่ม เพราะไฟล์ก่อนหน้าเปลี่ยนสถานะใบไปแล้ว
// แต่ละขั้นเป็นเทสของตัวเอง (serial) — ขั้นไหนพังจะเห็นทันทีว่าตรงกับขั้นไหนในเอกสาร

const MOBILE = { width: 360, height: 780, scheme: 'light' } as const;
const DESK = { width: 1280, height: 860, scheme: 'light' } as const;

const ADMIN = 'demo.admin@kmitl.ac.th';
const REPORTER = 'demo.s0005@kmitl.ac.th'; // ห้อง D1-303 — ห้องที่ยังไม่มีใบเปิด
const ROOMMATE = 'demo.s0006@kmitl.ac.th';
const OUTSIDER = 'demo.s0001@kmitl.ac.th'; // ห้อง D1-301
const LATE_STUDENT = 'demo.s0010@kmitl.ac.th'; // ยังไม่ได้กดเจอปัญหาเดียวกันในใบที่ขาดอีกคนเดียว
const PARTS_STUDENT = 'demo.s0004@kmitl.ac.th'; // ห้อง D1-302 ที่มีใบรออะไหล่
const TECH = 'demo.tech1@kmitl.ac.th';
const TECH_NAME = 'สมชาย ใจดี';
const SYMPTOM = 'แอร์มีน้ำหยดใส่โต๊ะตอนเปิดเกิน 1 ชั่วโมง';

test.describe.serial('เดโมตาม docs/demo.md', () => {
  let staff: Session;
  let acQr: string;
  let elecCommonQr: string;
  let ticket: TicketView;

  test.beforeAll(async ({ request }) => {
    execSync('npx ts-node test/ui-db.ts', { cwd: resolve('..'), stdio: 'inherit' });
    // seed ใหม่ = ผู้ใช้ id ใหม่ — token ที่เทสก่อนหน้าจำไว้ใช้ไม่ได้แล้ว
    for (const f of ['tokens.json', 'picks.json', 'awaiting.json']) rmSync(resolve('e2e/.tmp', f), { force: true });
    staff = await sessionFor(request, STAFF);
    const buildings = await apiGet<BuildingView[]>(request, staff, '/buildings');
    const d1 = buildings.find((b) => b.code === 'D1')!;
    const d2 = buildings.find((b) => b.code === 'D2')!;
    const room = (await apiGet<RoomView[]>(request, staff, '/rooms')).find(
      (r) => r.building_id === d1.id && r.room_no === '303',
    )!;
    const roomAssets = await apiGet<AssetListItemView[]>(request, staff, `/assets?room_id=${room.id}`);
    acQr = roomAssets.find((a) => a.asset_code === 'D1-303-AC')!.qr_token!;
    const common = await apiGet<AssetListItemView[]>(request, staff, `/assets?building_id=${d2.id}&common_area=true`);
    elecCommonQr = common.find((a) => a.asset_code === 'D2-CM-G-ELEC')!.qr_token!;
  });

  test('1. Staff พิมพ์ QR ของห้อง D1-303 จากหน้าเว็บ', async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, DESK, await sessionFor(request, STAFF));
    await page.goto('/app/qr');
    await page.getByLabel('ห้อง / ส่วนกลาง').selectOption({ label: 'D1 ห้อง 303' });
    const sticker = page
      .getByRole('list', { name: 'QR ของ D1 ห้อง 303' })
      .getByRole('listitem')
      .filter({ hasText: 'D1-303-AC' });
    await expect(sticker.getByRole('img')).toBeVisible();
    await page.context().close();
  });

  test('2. นักศึกษาสแกน QR แอร์ → login ด้วยรหัสทางอีเมล → แจ้งซ่อม ได้เลขใบ', async ({
    browser,
    request,
    baseURL,
  }) => {
    const page = await newPage(browser, baseURL!, MOBILE);
    await page.goto(`/app/scan/${acQr}`);
    await expect(page).toHaveURL(/\/app\/login\?next=/);
    await page.getByLabel('อีเมล').fill(REPORTER);
    await page.getByRole('button', { name: 'ส่งรหัสทางอีเมล' }).click();
    await page.getByLabel('รหัส 6 หลัก').fill(await codeFor(REPORTER));
    await page.getByRole('button', { name: 'ยืนยันรหัส' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องปรับอากาศ');
    // ขั้นหลัง ๆ ใช้ session นี้ต่อ — ขอรหัสซ้ำภายใน 60 วินาทีไม่ได้ (429)
    await rememberSession(page, REPORTER);
    await page.getByRole('link', { name: 'แจ้งซ่อมชิ้นนี้' }).click();
    await page.getByLabel('อาการ').fill(SYMPTOM);
    await page.getByRole('button', { name: 'ส่งแจ้งซ่อม 1 รายการ' }).click();
    const created = page.getByRole('list', { name: 'ใบที่สร้าง' }).getByRole('link');
    await expect(created).toContainText('รอมอบหมาย');
    const id = (await created.getAttribute('href'))!.split('/').pop()!;
    await page.context().close();
    ticket = await apiGet<TicketView>(request, staff, `/tickets/${id}`);
    expect(ticket.description).toBe(SYMPTOM);
  });

  test('3. แจ้งซ้ำไม่ได้: รูมเมทสแกนชิ้นเดิมเห็นใบเดิม · คนห้องอื่นสแกนไม่เห็นอะไรเลย', async ({
    browser,
    request,
    baseURL,
  }) => {
    const mate = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, ROOMMATE));
    await mate.goto(`/app/scan/${acQr}`);
    await expect(mate.getByText(ticket.ticket_no)).toBeVisible();
    await expect(mate.getByRole('button', { name: 'เจอปัญหาเดียวกัน' })).toBeVisible();
    await expect(mate.getByRole('link', { name: 'แจ้งซ่อมชิ้นนี้' })).toHaveCount(0);
    await mate.context().close();

    // ยิง API ตรง (ที่จะโชว์ใน Swagger): ชิ้นเดิมแจ้งซ้ำ → 409 · ห้องอื่น → 403 ก่อนเช็คซ้ำ ไม่รู้เลขใบของห้องนี้
    const post = async (email: string) =>
      request.post('/tickets', {
        headers: { Authorization: `Bearer ${(await sessionFor(request, email)).token}` },
        data: { items: [{ asset_id: ticket.asset_id, title: 'แอร์', description: 'ไม่เย็น' }] },
      });
    expect((await post(ROOMMATE)).status()).toBe(409);
    const other = await post(OUTSIDER);
    expect(other.status()).toBe(403);
    expect(await other.text()).not.toContain(ticket.ticket_no);

    const outsider = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, OUTSIDER));
    await outsider.goto(`/app/scan/${acQr}`);
    await expect(outsider.getByText('แจ้งซ่อมได้เฉพาะผู้พักห้องนั้น')).toBeVisible();
    await expect(outsider.getByText(ticket.ticket_no)).toHaveCount(0);
    await outsider.context().close();
  });

  test('4. Staff มอบหมายใบใหม่ให้ช่าง', async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, DESK, await sessionFor(request, STAFF));
    await page.goto(`/app/queue?ticket=${ticket.id}`);
    const panel = page.getByRole('complementary', { name: 'รายละเอียดใบที่เลือก' });
    await expect(panel.getByText(ticket.ticket_no)).toBeVisible();
    await panel.getByLabel('เลือกช่าง').selectOption({ label: TECH_NAME });
    await panel.getByRole('button', { name: 'มอบหมาย', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('มอบหมายให้ช่างสมชายแล้ว');
    await page.context().close();
  });

  const techResolves = async (page: Page, note: string) => {
    await page.goto(`/app/jobs/${ticket.id}`);
    await page.getByRole('button', { name: 'เริ่มงาน' }).click();
    await expect(page.getByRole('status')).toHaveText('เริ่มงานแล้ว');
    await page.getByRole('button', { name: 'ซ่อมเสร็จ' }).click();
    const sheet = page.getByRole('dialog', { name: 'แจ้งว่าซ่อมเสร็จ' });
    await sheet.getByLabel('ทำอะไรไปบ้าง (ไม่บังคับ)').fill(note);
    await sheet.getByRole('button', { name: 'ยืนยันซ่อมเสร็จ' }).click();
    await expect(page.getByRole('status')).toHaveText('ส่งให้ผู้พักยืนยันแล้ว');
    // กฎข้อ 2: ช่างไปได้สูงสุด resolved ไม่มีปุ่มปิดใบ
    await expect(page.getByText('คุณปิดใบเองไม่ได้')).toBeVisible();
  };

  test('5. ช่างเริ่มงาน → ซ่อมเสร็จ · ไม่มีปุ่มปิดใบเอง', async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, TECH));
    await page.goto('/app/jobs');
    await expect(page.getByRole('link', { name: new RegExp(ticket.ticket_no) })).toBeVisible();
    await techResolves(page, 'ล้างถาดน้ำทิ้งและท่อน้ำทิ้งตัน');
    await page.context().close();
  });

  test('6. ผู้แจ้งกด "ยังไม่หาย" → ใบกลับไปหาช่างคนเดิม', async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, REPORTER));
    await page.goto(`/app/tickets/${ticket.id}`);
    await page.getByRole('button', { name: 'ยังไม่หาย' }).click();
    const sheet = page.getByRole('dialog', { name: 'ยังไม่หาย' });
    await sheet.getByLabel('เล่าอาการที่ยังเป็นอยู่').fill('เปิดไปสองชั่วโมงน้ำหยดอีก');
    await sheet.getByRole('button', { name: 'ส่งกลับให้ช่าง' }).click();
    await expect(page.getByRole('status')).toHaveText('ส่งกลับให้ช่างสมชายแล้ว');
    await page.context().close();
  });

  test('7. ช่างเห็นใบในกลุ่ม "ถูกส่งกลับ" แล้วซ่อมรอบสอง', async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, TECH));
    await page.goto('/app/jobs');
    const row = page
      .getByRole('region', { name: 'ถูกส่งกลับ' })
      .getByRole('link', { name: new RegExp(ticket.ticket_no) });
    await expect(row).toContainText('เปิดไปสองชั่วโมงน้ำหยดอีก');
    await techResolves(page, 'เปลี่ยนท่อน้ำทิ้งเส้นใหม่');
    await page.context().close();
  });

  test('8. Staff ยืนยันใบห้องพักแทนไม่ได้ · รูมเมทกด "หายแล้ว ปิดใบ"', async ({ browser, request, baseURL }) => {
    const desk = await newPage(browser, baseURL!, DESK, await sessionFor(request, STAFF));
    await desk.goto(`/app/queue?ticket=${ticket.id}`);
    const panel = desk.getByRole('complementary', { name: 'รายละเอียดใบที่เลือก' });
    await expect(panel.getByText('Staff ยืนยันใบห้องพักแทนไม่ได้')).toBeVisible();
    await desk.context().close();

    const mate = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, ROOMMATE));
    await mate.goto(`/app/tickets/${ticket.id}`);
    await mate.getByRole('button', { name: 'หายแล้ว ปิดใบ' }).click();
    await mate.getByRole('dialog', { name: 'ยืนยันว่าหายแล้ว' }).getByRole('button', { name: 'ยืนยัน ปิดใบ' }).click();
    await expect(mate.getByRole('status')).toHaveText('ปิดใบแล้ว ขอบคุณที่ยืนยัน');
    await mate.context().close();
    expect((await apiGet<TicketView>(request, staff, `/tickets/${ticket.id}`)).status).toBe('closed');
  });

  test('9. ใบรออะไหล่: ช่างเห็นความเห็นภายใน · ผู้พักไม่เห็น', async ({ browser, request, baseURL }) => {
    const [parts] = await apiGet<TicketView[]>(request, staff, '/tickets?status=pending_parts&scope=room');
    const internal = 'อะไหล่ราคา 850 บาท';
    const techPage = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, TECH));
    await techPage.goto('/app/jobs');
    await expect(
      techPage.getByRole('region', { name: 'รออะไหล่' }).getByRole('link', { name: new RegExp(parts.ticket_no) }),
    ).toBeVisible();
    await techPage.goto(`/app/jobs/${parts.id}`);
    await expect(techPage.getByRole('region', { name: 'ความเห็น' })).toContainText(internal);
    await techPage.context().close();

    const student = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, PARTS_STUDENT));
    await student.goto(`/app/tickets/${parts.id}`);
    const box = student.getByRole('region', { name: 'ความเห็น' });
    await expect(box).toContainText('สั่งอะไหล่แล้ว');
    await expect(box).not.toContainText(internal);
    await student.context().close();
  });

  test('10. คนที่ 11 กดเจอปัญหาเดียวกัน → ระบบยกเป็นด่วนมาก', async ({ browser, request, baseURL }) => {
    const urgentBefore = (await apiGet<TicketView[]>(request, staff, '/tickets?priority=urgent&limit=100')).length;
    const page = await newPage(browser, baseURL!, MOBILE, await sessionFor(request, LATE_STUDENT));
    await page.goto(`/app/scan/${elecCommonQr}`);
    await page.getByRole('button', { name: 'เจอปัญหาเดียวกัน' }).click();
    await expect(page.getByText('คุณกดว่าเจอปัญหาเดียวกันแล้ว')).toBeVisible();
    await page.context().close();

    const urgent = await apiGet<TicketView[]>(request, staff, '/tickets?priority=urgent&limit=100');
    expect(urgent).toHaveLength(urgentBefore + 1);
    expect(urgent.some((t) => t.report_count === 11)).toBe(true);
  });

  test('11. Staff เห็นใบส่วนกลางที่มีคนแย้งว่ายังไม่หาย', async ({ browser, request, baseURL }) => {
    const page = await newPage(browser, baseURL!, DESK, await sessionFor(request, STAFF));
    await page.goto('/app/queue');
    await page
      .getByRole('group', { name: 'กรองคิว' })
      .getByRole('button', { name: /มีคนแย้งว่ายังไม่หาย/ })
      .click();
    await expect(page.locator('tbody tr[tabindex]')).not.toHaveCount(0);
    await page.context().close();
  });

  test('12. admin สั่งรัน job ปิดอัตโนมัติ → ปิดใบที่เลย 3 วัน ข้ามใบที่มีคนแย้ง · รายงานแยก "ระบบปิดให้"', async ({
    browser,
    request,
    baseURL,
  }) => {
    const admin = await sessionFor(request, ADMIN);
    const disputed = await apiGet<TicketView[]>(request, staff, '/tickets?disputed=true&status=resolved');
    const res = await request.post('/admin/jobs/auto-close/run', {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { closed_count: number; tickets: { id: string }[] };
    expect(body.closed_count).toBeGreaterThanOrEqual(2);
    for (const d of disputed) expect(body.tickets.map((t) => t.id)).not.toContain(d.id);

    const page = await newPage(browser, baseURL!, DESK, admin);
    await page.goto('/app/reports');
    await expect(page.getByText(/ระบบปิดให้/).first()).toBeVisible();
    await page.context().close();
  });
});
