import { api } from './client';
import type { TokenResponse } from './types';

// ค่าเดียวกับ OtpService ฝั่ง backend — ใช้แค่บอกผู้ใช้ เวลาจริงตัดสินที่ API (429 ส่ง retry_after มาด้วย)
export const CODE_TTL_MINUTES = 10;
export const RESEND_AFTER_SECONDS = 60;

export const requestCode = (email: string) =>
  api<{ message: string }>('/auth/request-code', { method: 'POST', body: { email } });

export const verifyCode = (email: string, code: string) =>
  api<TokenResponse>('/auth/verify-code', { method: 'POST', body: { email, code } });
