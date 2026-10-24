import { ApiError } from './client';

// ข้อความที่ผู้ใช้เห็นต่อ code (UI-PLAN หัวข้อ 6) — แยกด้วย code เสมอ ไม่แยกด้วยข้อความของ API
const detail = (e: ApiError, key: string): unknown =>
  typeof e.details === 'object' && e.details !== null ? (e.details as Record<string, unknown>)[key] : undefined;

export const NOT_FOUND_TICKET = 'ไม่พบใบนี้ หรือคุณไม่มีสิทธิ์ดู';

export const errorMessage = (e: unknown): string => {
  if (!(e instanceof ApiError)) return 'เชื่อมต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  switch (e.code) {
    case 'INVALID_TRANSITION':
      return 'ใบนี้เปลี่ยนสถานะไปแล้ว';
    case 'ALREADY_REPORTED':
      return 'คุณกดว่าเจอปัญหาเดียวกันแล้ว';
    case 'TICKET_NOT_OPEN':
      return 'ใบนี้ปิดไปแล้ว';
    case 'QUOTA_EXCEEDED':
      return `คุณมีใบที่ยังเปิดอยู่ครบ ${Number(detail(e, 'limit') ?? 10)} ใบแล้ว รอให้ปิดก่อนหรือติดต่อ Staff`;
    case 'RATE_LIMITED': {
      const wait = Number(detail(e, 'retry_after'));
      return Number.isFinite(wait)
        ? `ขอรหัสถี่เกินไป ลองใหม่ใน ${wait} วินาที`
        : 'ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่';
    }
    case 'NOT_FOUND':
      return NOT_FOUND_TICKET;
    case 'FORBIDDEN':
      return 'คุณไม่มีสิทธิ์ทำรายการนี้';
    default:
      return e.message;
  }
};

export const retryAfter = (e: unknown): number | null => {
  const v = e instanceof ApiError ? Number(detail(e, 'retry_after')) : NaN;
  return Number.isFinite(v) ? v : null;
};

export const attemptsLeft = (e: unknown): number | null => {
  const v = e instanceof ApiError ? detail(e, 'attempts_left') : undefined;
  return typeof v === 'number' ? v : null;
};
