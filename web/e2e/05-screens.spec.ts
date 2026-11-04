import { expect, test } from '@playwright/test';
import type { AssetListItemView, TicketView } from '../src/api/schema.gen';
import { newPage, shoot } from './screens';
import { apiGet, awaitingConfirm, sessionFor, STAFF } from './support';

// screenshot ทุกหน้าของนักศึกษาที่ 360px และ 1280px ทั้ง light/dark (UI-PLAN 9) — ไว้เทียบกับ docs/ui/mockup.html
// แต่ละขนาด login ด้วยอีเมลคนละอีเมล — API ให้ขอรหัสได้ 1 ครั้ง/60 วินาที/อีเมล
const VARIANTS = [
  { width: 360, height: 780, scheme: 'light' as const, email: 'demo.s0011@kmitl.ac.th' },
  { width: 360, height: 780, scheme: 'dark' as const, email: 'demo.s0012@kmitl.ac.th' },
  { width: 1280, height: 860, scheme: 'light' as const, email: 'demo.s0013@kmitl.ac.th' },
  { width: 1280, height: 860, scheme: 'dark' as const, email: 'demo.s0014@kmitl.ac.th' },
];

for (const v of VARIANTS) {
  test(`screenshot หน้านักศึกษา ${v.width}px ${v.scheme}`, async ({ browser, request, baseURL }) => {
    test.setTimeout(90_000);
    const fx = await awaitingConfirm(request, 2);
    const me = await sessionFor(request, fx.student.email);
    const staff = await sessionFor(request, STAFF);
    const roomAssets = await apiGet<AssetListItemView[]>(request, staff, `/assets?room_id=${fx.ticket.room_id}`);
    const free = roomAssets.filter((a) => !a.open_ticket);
    const scanFree = free[free.length - 1];
    const open = await apiGet<TicketView[]>(
      request,
      staff,
      '/tickets?scope=room&status=open&status=assigned&status=in_progress&status=pending_parts&limit=100',
    );
    const elsewhere = open.find((t) => t.room_id !== fx.ticket.room_id)!;
    const elsewhereAsset = await apiGet<{ qr_token: string }>(request, staff, `/assets/${elsewhere.asset_id}`);

    // ---- login (ยังไม่มี session) ----
    const guest = await newPage(browser, baseURL!, v);
    await guest.goto(`/app/scan/${fx.qrToken}`);
    await expect(guest.getByText('คุณสแกน QR ครุภัณฑ์ในหอพัก')).toBeVisible();
    await shoot(guest, '01-login-email', v);
    await guest.getByLabel('อีเมล').fill(v.email);
    await guest.getByRole('button', { name: 'ส่งรหัสทางอีเมล' }).click();
    await expect(guest.getByLabel('รหัส 6 หลัก')).toBeVisible();
    await guest.getByLabel('รหัส 6 หลัก').fill('000000');
    await guest.getByRole('button', { name: 'ยืนยันรหัส' }).click();
    await expect(guest.locator('.errtext')).toBeVisible();
    await shoot(guest, '02-login-code', v);
    await guest.context().close();

    const page = await newPage(browser, baseURL!, v, me);

    // ---- หน้าแรกหลังสแกน 3 แบบ ----
    await page.goto(`/app/scan/${fx.qrToken}`);
    await expect(page.getByRole('link', { name: 'ดูและยืนยันผลซ่อม' })).toBeVisible();
    await shoot(page, '03-scan-awaiting-confirm', v);

    await page.goto(`/app/scan/${scanFree.qr_token}`);
    await expect(page.getByRole('link', { name: 'แจ้งซ่อมชิ้นนี้' })).toBeVisible();
    await shoot(page, '04-scan-can-report', v);

    await page.goto(`/app/scan/${elsewhereAsset.qr_token}`);
    await expect(page.getByText('แจ้งซ่อมได้เฉพาะผู้พักห้องนั้น')).toBeVisible();
    await shoot(page, '05-scan-other-room', v);

    // ---- แจ้งซ่อม: เลือกแล้วไม่กรอกอาการ (error ใต้ช่อง) → ส่ง → หน้าสำเร็จ ----
    await page.goto('/app/report');
    const list = page.getByRole('list', { name: 'ครุภัณฑ์' });
    await list.getByRole('button', { pressed: false }).first().click();
    await page.getByRole('button', { name: /^ส่งแจ้งซ่อม/ }).click();
    await expect(page.getByText('บอกอาการสั้น ๆ ให้ช่างเตรียมของได้ถูก')).toBeVisible();
    await shoot(page, '06-report-missing-symptom', v);
    await page.getByLabel('อาการ').fill('เปิดแล้วกะพริบ บางครั้งไม่ติด');
    await page.getByRole('button', { name: /^ส่งแจ้งซ่อม/ }).click();
    await expect(page.getByText('ส่งแจ้งซ่อมแล้ว')).toBeVisible();
    await shoot(page, '07-report-done', v);

    // ---- ส่งซ่อมแล้ว ----
    await page.goto('/app/tickets');
    await expect(page.getByRole('region', { name: 'รอคุณยืนยัน' })).toBeVisible();
    await shoot(page, '08-my-tickets', v);

    // ---- รายละเอียดใบ + bottom sheet ----
    await page.goto(`/app/tickets/${fx.ticket.id}`);
    await expect(page.getByRole('button', { name: 'หายแล้ว ปิดใบ' })).toBeVisible();
    await expect(page.locator('.tl li').first()).toBeVisible();
    await shoot(page, '09-ticket-awaiting-confirm', v);

    await page.getByRole('button', { name: 'หายแล้ว ปิดใบ' }).click();
    await expect(page.getByRole('dialog', { name: 'ยืนยันว่าหายแล้ว' })).toBeVisible();
    await shoot(page, '10-sheet-confirm', v);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'ยังไม่หาย' }).click();
    const sheet = page.getByRole('dialog', { name: 'ยังไม่หาย' });
    await sheet.getByRole('button', { name: 'ส่งกลับให้ช่าง' }).click();
    await expect(sheet.locator('.errtext')).toBeVisible();
    await shoot(page, '11-sheet-reopen-missing-note', v);
    await page.keyboard.press('Escape');

    // ---- ใบที่ยกเลิกได้ (เพิ่งแจ้งเมื่อกี้ ยังไม่มีคนรับ) + sheet ยกเลิก ----
    await page.goto('/app/tickets');
    await page.getByRole('region', { name: 'กำลังดำเนินการ' }).getByRole('link').first().click();
    await expect(page.getByRole('button', { name: 'ยกเลิกการแจ้ง' })).toBeVisible();
    await shoot(page, '12-ticket-open', v);
    await page.getByRole('button', { name: 'ยกเลิกการแจ้ง' }).click();
    await expect(page.getByRole('dialog', { name: 'ยกเลิกการแจ้ง' })).toBeVisible();
    await shoot(page, '13-sheet-cancel', v);
    await page.keyboard.press('Escape');

    // ---- 404 ----
    await page.goto('/app/tickets/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('ไม่พบใบนี้ หรือคุณไม่มีสิทธิ์ดู')).toBeVisible();
    await shoot(page, '14-ticket-not-found', v);

    await page.context().close();
  });
}
