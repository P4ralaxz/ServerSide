import { clearSession, getToken } from '../auth/session';

// error ทุกตัวจาก API มี code ให้แยกกรณีด้วยโปรแกรม (DESIGN 8, UI-PLAN 6) — หน้าจอห้ามแยกด้วยข้อความ
export class ApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  // ช่องที่ผิดจาก VALIDATION_FAILED → แสดงใต้ช่องนั้น (UI-PLAN 2 ข้อ 5)
  fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_FAILED' || !Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { field?: unknown; reason?: unknown }[]) {
      if (typeof d.field === 'string' && !(d.field in out)) out[d.field] = String(d.reason ?? '');
    }
    return out;
  }
}

// 404 = ไม่มีใบ หรือมองไม่เห็นใบนั้น — API ตอบเหมือนกันโดยตั้งใจ หน้าจอจึงห้ามแยกสองกรณีนี้ (UI-PLAN 6)
export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.code === 'NOT_FOUND';

// array = ส่ง param ซ้ำหลายค่า (?status=open&status=assigned) ตามที่ API รับ
type Query = Record<string, string | number | boolean | readonly string[] | undefined | null>;

const LOGIN = '/app/login';

// 401 ระหว่างใช้งาน (token หมดอายุ / บัญชีถูกระงับ) → ล้าง session แล้วกลับหน้า login พร้อมจำหน้าที่อยู่ (UI-PLAN 1)
// ไม่ใช้กับคำขอที่ไม่มี token เช่น verify-code ที่รหัสผิด — นั่นคือ 401 ที่หน้า login ต้องแสดงเอง
const toLogin = (): void => {
  clearSession();
  const here = window.location.pathname + window.location.search;
  if (!window.location.pathname.startsWith(LOGIN)) {
    window.location.assign(`${LOGIN}?next=${encodeURIComponent(here)}`);
  }
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) qs.append(k, String(item));
    else qs.set(k, String(v));
  }
  const q = qs.toString();
  const url = q ? `${path}?${q}` : path;

  const token = getToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const body = (await res.json().catch(() => ({}))) as { code?: unknown; message?: unknown; details?: unknown };
  if (res.status === 401 && token) toLogin();
  throw new ApiError(
    res.status,
    typeof body.code === 'string' ? body.code : `HTTP_${res.status}`,
    typeof body.message === 'string' ? body.message : 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง',
    body.details,
  );
}
