import { expect, test } from '@playwright/test';
import type { SlaSummaryView, TechnicianReportRow } from '../src/api/schema.gen';
import { apiGet, sessionFor, signIn, STAFF } from './support';

// หน้ารายงาน: ตัวเลขบนจอมาจาก API ชุดเดียวกัน ไม่ได้คิดเองบนหน้าเว็บ
test('รายงาน: KPI 4 ตัว, เวลาค้างต่อขั้น, ใครปิดใบ และตารางช่าง ตรงกับ API', async ({ page, request }) => {
  const staff = await sessionFor(request, STAFF);
  await signIn(page, staff);
  await page.goto('/app/reports?period=all');

  const summary = await apiGet<SlaSummaryView>(request, staff, '/reports/sla-summary');
  const techs = await apiGet<TechnicianReportRow[]>(request, staff, '/reports/technicians');
  const m = summary.total;

  const kpis = page.locator('.kpi');
  await expect(kpis).toHaveCount(4);
  const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;
  await expect(kpis.nth(1).locator('b')).toHaveText(pct(m.user_confirmed, m.closed_tickets));
  await expect(kpis.nth(2).locator('b')).toHaveText(pct(m.auto_closed, m.closed_tickets));
  await expect(kpis.nth(3).locator('b')).toHaveText(pct(m.reopened_tickets, m.total_tickets));

  const stages = page.getByRole('region', { name: 'เวลาเฉลี่ยที่ค้างในแต่ละขั้น' });
  await expect(stages.locator('.bar')).toHaveCount(5);
  // ช่วงรออะไหล่ไม่นับเข้าเวลาซ่อม (DESIGN 9) — บอกบนกราฟด้วย
  await expect(stages.getByText(/รออะไหล่.*ไม่นับเข้าเวลาซ่อม/)).toBeVisible();

  const closed = page.getByRole('region', { name: 'ใครเป็นคนปิดใบ' });
  await expect(closed.getByText(/^ผู้พักยืนยัน \d+%$/)).toBeVisible();
  await expect(closed.getByText(/^ระบบปิดให้ \d+%$/)).toBeVisible();

  const table = page.getByRole('region', { name: 'งานของช่างแต่ละคน' }).locator('tbody tr');
  await expect(table).toHaveCount(techs.length);
  for (const t of techs) await expect(page.getByRole('cell', { name: t.technician.name! })).toBeVisible();

  // เปลี่ยนช่วงเวลา → อยู่ใน URL
  await page.getByLabel('ช่วงเวลา').selectOption({ label: 'เดือนนี้' });
  await expect(page).toHaveURL(/period=thisMonth/);
  await expect(page.locator('.kpi')).toHaveCount(4);
});
