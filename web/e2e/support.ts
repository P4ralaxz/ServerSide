import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AssetView, TicketView, TokenResponse, UserView } from '../src/api/schema.gen';

// เครื่องมือของเทส Playwright — ข้อมูลทุกชิ้นหาผ่าน API จริงด้วย token ของ Staff (ไม่แตะ DB ตรง ไม่ mock)
// ข้อมูลเดโมมาจาก seed ที่ global-setup รันใหม่ทุกรอบ

export const MAIL_FILE = resolve('e2e/.tmp/mail.json');
const TOKENS_FILE = resolve('e2e/.tmp/tokens.json');
const SESSION_KEY = 'dorm.session';
export const STAFF = 'demo.staff1@kmitl.ac.th';

export interface Session {
  token: string;
  user: UserView;
}

// รหัส OTP ล่าสุดของอีเมลนี้ จากไฟล์ที่ MailService ตัวปลอมของ ui-server เขียนไว้
export const codeFor = async (email: string, after?: string): Promise<string> => {
  let code: string | undefined;
  await expect
    .poll(
      () => {
        if (!existsSync(MAIL_FILE)) return undefined;
        code = (JSON.parse(readFileSync(MAIL_FILE, 'utf8')) as Record<string, string>)[email];
        return code !== undefined && code !== after ? code : undefined;
      },
      { message: `รอรหัสของ ${email}` },
    )
    .toBeDefined();
  return code!;
};

const readTokens = (): Record<string, Session> =>
  existsSync(TOKENS_FILE) ? (JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as Record<string, Session>) : {};

// login ผ่าน API หนึ่งครั้งต่ออีเมลต่อรอบ แล้วเก็บ token ไว้ใช้ซ้ำ
// API จำกัดการขอรหัส 1 ครั้ง/60 วินาที/อีเมล — ถ้าทุกเทส login ใหม่ เทสที่สองของอีเมลเดียวกันจะโดน 429
export const sessionFor = async (request: APIRequestContext, email: string): Promise<Session> => {
  const cached = readTokens()[email];
  if (cached) return cached;
  const before = existsSync(MAIL_FILE)
    ? (JSON.parse(readFileSync(MAIL_FILE, 'utf8')) as Record<string, string>)[email]
    : undefined;
  expect((await request.post('/auth/request-code', { data: { email } })).status()).toBe(202);
  const code = await codeFor(email, before);
  const res = await request.post('/auth/verify-code', { data: { email, code } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as TokenResponse;
  const s = { token: body.access_token, user: body.user };
  mkdirSync(dirname(TOKENS_FILE), { recursive: true });
  writeFileSync(TOKENS_FILE, JSON.stringify({ ...readTokens(), [email]: s }));
  return s;
};

// เก็บ session ที่ได้จากการ login ผ่านหน้าเว็บไว้ให้เทสถัดไปใช้ — อีเมลนี้ขอรหัสซ้ำภายใน 60 วินาทีไม่ได้
export const rememberSession = async (page: Page, email: string): Promise<void> => {
  const raw = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
  expect(raw, 'หน้าเว็บต้องเก็บ session หลัง login').not.toBeNull();
  mkdirSync(dirname(TOKENS_FILE), { recursive: true });
  writeFileSync(TOKENS_FILE, JSON.stringify({ ...readTokens(), [email]: JSON.parse(raw!) as Session }));
};

// ใส่ session ลง sessionStorage ก่อนหน้าเว็บโหลด — เหมือนผู้ใช้ที่ login แล้ว
export const signIn = async (page: Page, s: Session): Promise<void> => {
  await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [SESSION_KEY, JSON.stringify(s)]);
};

export const apiGet = async <T>(request: APIRequestContext, s: Session, path: string): Promise<T> => {
  const res = await request.get(path, { headers: { Authorization: `Bearer ${s.token}` } });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return (await res.json()) as T;
};

export interface Fixture {
  ticket: TicketView;
  student: UserView;
  qrToken: string;
}

const studentsOf = async (request: APIRequestContext, staff: Session, roomId: string) =>
  apiGet<UserView[]>(request, staff, `/users?role=student&room_id=${roomId}`);

const qrOf = async (request: APIRequestContext, staff: Session, assetId: string) => {
  const a = await apiGet<AssetView>(request, staff, `/assets/${assetId}`);
  return a.qr_token!;
};

// ใบห้องพักที่รอผู้พักยืนยัน เรียงตามเลขใบ — แต่ละเทสหยิบคนละลำดับ จะได้ไม่แก้ใบเดียวกัน
// index 0 = เส้นทาง "ยังไม่หาย" · 1 = เส้นทางยืนยัน · 2 = screenshot
// ลำดับจำไว้ตั้งแต่ครั้งแรกของรอบ: พอเทสก่อนหน้ายืนยัน / ส่งกลับไปแล้ว ใบนั้นไม่ resolved แล้ว ลำดับจะเลื่อน
const PLAN_FILE = resolve('e2e/.tmp/awaiting.json');
export const awaitingConfirm = async (request: APIRequestContext, index: number): Promise<Fixture> => {
  const staff = await sessionFor(request, STAFF);
  if (!existsSync(PLAN_FILE)) {
    const resolved = await apiGet<TicketView[]>(request, staff, '/tickets?status=resolved&scope=room&limit=100');
    const ids = resolved
      .filter((t) => t.auto_close_at !== null)
      .sort((x, y) => x.ticket_no.localeCompare(y.ticket_no))
      .map((t) => t.id);
    mkdirSync(dirname(PLAN_FILE), { recursive: true });
    writeFileSync(PLAN_FILE, JSON.stringify(ids));
  }
  const id = (JSON.parse(readFileSync(PLAN_FILE, 'utf8')) as string[])[index];
  expect(id, `seed ต้องมีใบห้องพักรอยืนยันอย่างน้อย ${index + 1} ใบ`).toBeDefined();
  const ticket = await apiGet<TicketView>(request, staff, `/tickets/${id}`);
  const [student] = await studentsOf(request, staff, ticket.room_id!);
  return { ticket, student, qrToken: await qrOf(request, staff, ticket.asset_id) };
};

// ใบที่ยังเปิดอยู่ของห้องหนึ่ง + นักศึกษาของอีกห้อง (สแกนข้ามห้อง)
export const openTicketOfOtherRoom = async (
  request: APIRequestContext,
): Promise<{ ticket: TicketView; outsider: UserView; qrToken: string }> => {
  const staff = await sessionFor(request, STAFF);
  const open = await apiGet<TicketView[]>(
    request,
    staff,
    '/tickets?scope=room&status=open&status=assigned&status=in_progress&status=pending_parts&limit=100',
  );
  const ticket = open.sort((a, b) => a.ticket_no.localeCompare(b.ticket_no))[0];
  const students = await apiGet<UserView[]>(request, staff, '/users?role=student');
  const outsider = students.find((u) => u.room_id && u.room_id !== ticket.room_id)!;
  return { ticket, outsider, qrToken: await qrOf(request, staff, ticket.asset_id) };
};

// นักศึกษาที่ห้องมีทั้งชิ้นที่มีใบเปิดอยู่และชิ้นที่ยังแจ้งได้ — ไม่ใช่ห้องที่ใช้ในเส้นทางยืนยัน
export const reporterWithMixedRoom = async (
  request: APIRequestContext,
  avoidRooms: string[],
): Promise<{ student: UserView; openTicket: TicketView }> => {
  const staff = await sessionFor(request, STAFF);
  const open = await apiGet<TicketView[]>(
    request,
    staff,
    '/tickets?scope=room&status=open&status=assigned&status=in_progress&status=pending_parts&limit=100',
  );
  const sorted = open.sort((a, b) => a.ticket_no.localeCompare(b.ticket_no));
  const ticket = sorted.find((t) => !avoidRooms.includes(t.room_id!)) ?? sorted[0];
  const [student] = await studentsOf(request, staff, ticket.room_id!);
  return { student, openTicket: ticket };
};

// ไม่มีหน้าไหนล้นจอแนวนอน (UI-PLAN 9)
export const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll, 'หน้าล้นจอแนวนอน').toBeLessThanOrEqual(inner);
};
