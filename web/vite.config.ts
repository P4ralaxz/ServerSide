import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ตอนพัฒนา Vite เสิร์ฟหน้าเว็บที่ :5173/app/ แล้วส่งทุก prefix ของ API ต่อไปที่ Nest (UI-PLAN 1, 7)
// ตอนใช้จริง Nest เสิร์ฟ web/dist ที่ /app เอง — path ของ API เหมือนกันทั้งสองแบบ จึงไม่ต้องตั้ง CORS
const API = 'http://localhost:3100';
const API_PREFIXES = [
  '/auth',
  '/tickets',
  '/scan',
  '/assets',
  '/rooms',
  '/buildings',
  '/users',
  '/reports',
  '/admin',
  '/health',
];

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, { target: API }])),
  },
});
