import { expect, test } from '@playwright/test';
import { newPage, shoot, type Variant } from './screens';
import { pickOnce, sessionFor, STAFF, technicianOf } from './support';

// screenshot หน้าใหม่ของ UI-2 (ช่าง, คิวงาน Staff, รายงาน) ที่ 360px และ 1280px ทั้ง light/dark (UI-PLAN 9)
// หน้า Staff / รายงานใช้บนเดสก์ท็อปเป็นหลัก แต่ต้องไม่ล้นจอแนวนอนที่จอแคบด้วย (UI-PLAN 2 ข้อ 7)
const VARIANTS: Variant[] = [
  { width: 360, height: 780, scheme: 'light' },
  { width: 360, height: 780, scheme: 'dark' },
  { width: 1280, height: 860, scheme: 'light' },
  { width: 1280, height: 860, scheme: 'dark' },
];

for (const v of VARIANTS) {
  test(`screenshot หน้า UI-2 ${v.width}px ${v.scheme}`, async ({ browser, request, baseURL }) => {
    test.setTimeout(90_000);
    // ใบที่ถูกส่งกลับ (ดูอย่างเดียว ไม่แตะ) + ใบที่ยังไม่เริ่มงาน (เริ่มงานรอบแรกเพื่อเปิด sheet ซ่อมเสร็จ / รออะไหล่)
    const returned = await pickOnce(
      request,
      'screens-returned',
      (all) =>
        all.find((t) => t.status === 'assigned' && t.reopen_count > 0 && t.room_id === null) ??
        all.find((t) => t.status === 'assigned' && t.reopen_count > 0),
    );
    const startable = await pickOnce(request, 'screens-start', (all) =>
      all.find((t) => t.status === 'assigned' && t.reopen_count === 0 && (t.room_id === null || t.permission_to_enter)),
    );

    // ---- ช่าง ----
    const tech = await newPage(
      browser,
      baseURL!,
      v,
      await sessionFor(request, (await technicianOf(request, returned)).email),
    );
    await tech.goto('/app/jobs');
    await expect(tech.getByRole('region', { name: 'ถูกส่งกลับ' })).toBeVisible();
    await shoot(tech, '15-tech-jobs', v);

    await tech.goto(`/app/jobs/${returned.id}`);
    await expect(tech.getByText(/ถูกส่งกลับครั้งที่/)).toBeVisible();
    await shoot(tech, '16-tech-job-returned', v);

    await tech.getByRole('button', { name: /นัดเวลาเข้าซ่อม|เลื่อนนัด/ }).click();
    const sched = tech.getByRole('dialog', { name: 'นัดเวลา' });
    // ล้างช่องก่อน — ถ้ามีนัดในอนาคตอยู่แล้ว ช่องจะเติมค่าเดิมไว้และกดบันทึกจะเลื่อนนัดจริง
    await sched.getByLabel('วันและเวลา').fill('');
    await sched.getByRole('button', { name: 'บันทึกนัด' }).click();
    await expect(sched.locator('.errtext')).toBeVisible();
    await shoot(tech, '17-tech-sheet-schedule', v);
    await tech.context().close();

    const tech2 = await newPage(
      browser,
      baseURL!,
      v,
      await sessionFor(request, (await technicianOf(request, startable)).email),
    );
    await tech2.goto(`/app/jobs/${startable.id}`);
    const start = tech2.getByRole('button', { name: 'เริ่มงาน' });
    await expect(tech2.locator('.card .pill').first()).toBeVisible();
    if (await start.isVisible()) {
      await start.click();
      await expect(tech2.getByRole('status')).toHaveText('เริ่มงานแล้ว');
    }
    await expect(tech2.getByRole('button', { name: 'ซ่อมเสร็จ' })).toBeVisible();
    await shoot(tech2, '18-tech-job-in-progress', v);

    await tech2.getByRole('button', { name: 'ซ่อมเสร็จ' }).click();
    await expect(tech2.getByRole('dialog', { name: 'แจ้งว่าซ่อมเสร็จ' })).toBeVisible();
    await shoot(tech2, '19-tech-sheet-resolve', v);
    await tech2.keyboard.press('Escape');

    await tech2.getByRole('button', { name: 'รออะไหล่' }).click();
    const parts = tech2.getByRole('dialog', { name: 'รออะไหล่' });
    await parts.getByRole('button', { name: 'บันทึก' }).click();
    await expect(parts.locator('.errtext')).toBeVisible();
    await shoot(tech2, '20-tech-sheet-parts-missing', v);
    await tech2.context().close();

    // ---- Staff ----
    const staff = await newPage(browser, baseURL!, v, await sessionFor(request, STAFF));
    await staff.goto('/app/queue?filter=unassigned');
    const firstRow = staff.locator('tbody tr[tabindex]').first();
    await firstRow.click();
    await expect(staff.getByRole('button', { name: 'มอบหมาย', exact: true })).toBeVisible();
    await shoot(staff, '21-staff-queue-unassigned', v);

    await staff.getByRole('button', { name: 'ไม่รับเรื่อง' }).click();
    await staff.getByRole('button', { name: 'ยืนยันไม่รับเรื่อง' }).click();
    await expect(staff.locator('.side .errtext')).toBeVisible();
    await shoot(staff, '22-staff-reject-missing-reason', v);

    await staff.goto('/app/queue?filter=common_pending_confirm');
    await staff.locator('tbody tr[tabindex]').first().click();
    await expect(staff.getByRole('button', { name: 'ยืนยันว่าหายแล้ว' })).toBeVisible();
    await shoot(staff, '23-staff-common-awaiting-confirm', v);

    await staff.goto('/app/queue?filter=disputed');
    await staff.locator('tbody tr[tabindex]').first().click();
    await expect(staff.getByText('มีคนแย้งว่ายังไม่หาย').last()).toBeVisible();
    await shoot(staff, '24-staff-disputed', v);

    await staff.goto(`/app/queue?filter=open_total&ticket=${returned.id}`);
    await expect(staff.locator('.side .tl li').first()).toBeVisible();
    await shoot(staff, '25-staff-returned-timeline', v);

    // ---- รายงาน ----
    await staff.goto('/app/reports');
    await expect(staff.locator('.kpi')).toHaveCount(4);
    await expect(staff.locator('.bar').first()).toBeVisible();
    await shoot(staff, '26-reports', v);
    await staff.context().close();
  });
}
