import type { UserView } from '../api/schema.gen';

// JWT อยู่ใน sessionStorage (UI-PLAN 1) — ปิดแท็บแล้วหายเอง ไม่ต้องแก้ auth ฝั่ง API เป็น cookie
// user เก็บไว้คู่กันเพื่อเลือกหน้าแรกและรู้ห้องของตัวเอง — สิทธิ์จริงยังตรวจที่ API ทุก request
const KEY = 'dorm.session';

export interface Session {
  token: string;
  user: UserView;
}

const read = (): Session | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

export const getSession = read;
export const getToken = (): string | null => read()?.token ?? null;

export const setSession = (s: Session): void => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ — ใช้งานต่อได้จนปิดหน้า แต่ refresh แล้วต้อง login ใหม่
  }
};

export const clearSession = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ไม่มีอะไรให้ล้าง
  }
};

// ออกจากระบบ = ล้าง token แล้วโหลดหน้า login ใหม่ทั้งหน้า
// โหลดใหม่ทั้งหน้าเพื่อให้แคชของ react-query และ state ในหน่วยความจำหายไปพร้อมกัน
// ถ้าแค่ navigate คนที่ login ต่อในแท็บเดิม (เครื่องส่วนกลางของหอ) จะเห็นรายการใบของคนก่อนแวบหนึ่ง
// replace = กด back แล้วไม่กลับไปหน้าที่ต้อง login (ถึงกลับไปได้ RequireAuth ก็ส่งมาหน้า login อยู่ดี)
// token ฝั่ง API ยังใช้ได้จนหมดอายุ (JWT_EXPIRES_IN) — ไม่เพิกถอนฝั่งเซิร์ฟเวอร์ แต่ token อยู่ใน sessionStorage ของแท็บนี้เท่านั้น
export const logout = (): void => {
  clearSession();
  window.location.replace('/app/login');
};

// กันลิงก์ "next" พาออกนอกแอป (open redirect) — รับเฉพาะ path ใต้ /app/
export const safeNext = (next: string | null): string =>
  next && next.startsWith('/app/') && !next.startsWith('//') ? next : '/app/';
