import { defineConfig } from '@playwright/test';
import { MAIL_FILE } from './e2e/support';

// Playwright รันกับ backend จริงที่ seed แล้ว ไม่ mock API (UI-PLAN 9)
// backend = test/ui-server.ts (AppModule ตัวจริง + MailService ปลอมที่เขียนรหัสลงไฟล์) เสิร์ฟ web/dist ที่ /app
// ต้อง web:build ก่อน — ชุดคำสั่งของช่วง UI รัน web:build ก่อน web:e2e อยู่แล้ว
export const UI_PORT = 3199;

export default defineConfig({
  testDir: 'e2e',
  // ทุกเทสใช้ DB ชุดเดียวกัน — รันทีละตัวตามลำดับไฟล์ ไม่ให้เทสหนึ่งแก้ใบที่อีกเทสกำลังดู
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${UI_PORT}`,
    // Chrome ที่ติดตั้งในเครื่อง — ไม่ดาวน์โหลด Chromium ของ Playwright (DESIGN 12.1.3)
    channel: 'chrome',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    viewport: { width: 360, height: 780 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx ts-node test/ui-server.ts',
    cwd: '..',
    url: `http://localhost:${UI_PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { UI_PORT: String(UI_PORT), UI_MAIL_FILE: MAIL_FILE, AUTO_CLOSE_CRON_ENABLED: 'false' },
  },
});
