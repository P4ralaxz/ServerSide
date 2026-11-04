import type { Browser, Page } from '@playwright/test';
import { expectNoHorizontalOverflow, signIn, type Session } from './support';

// เครื่องมือถ่าย screenshot ของทุกหน้า (UI-PLAN 9) — ใช้ร่วมกันระหว่างหน้านักศึกษากับหน้า UI-2
// ทุกภาพตรวจด้วยว่าไม่ล้นจอแนวนอน · ไฟล์อยู่ที่ web/e2e/__screenshots__/<หน้า>-<กว้าง>-<โหมด>.png
const DIR = 'e2e/__screenshots__';

export interface Variant {
  width: number;
  height: number;
  scheme: 'light' | 'dark';
}

export const shoot = async (page: Page, name: string, v: Variant): Promise<void> => {
  await page.evaluate(() => document.fonts.ready);
  await expectNoHorizontalOverflow(page);
  // ขยายจอให้สูงเท่าเนื้อหาก่อนถ่าย — fullPage ของ Playwright วาดแถบล่าง (sticky) ค้างกลางภาพ ไม่ใช่ที่ขอบล่างจริง
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: v.width, height: Math.max(v.height, height) });
  await page.screenshot({ path: `${DIR}/${name}-${v.width}-${v.scheme}.png` });
  await page.setViewportSize({ width: v.width, height: v.height });
};

export const newPage = async (browser: Browser, baseURL: string, v: Variant, s?: Session): Promise<Page> => {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: v.width, height: v.height },
    colorScheme: v.scheme,
    reducedMotion: 'reduce',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  });
  const page = await ctx.newPage();
  if (s) await signIn(page, s);
  return page;
};
