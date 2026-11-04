import type { User } from '../api/types';

// role → หน้าที่เปิดได้ อยู่ที่ไฟล์นี้ที่เดียว (UI-PLAN 2 ข้อ 1) — routes.tsx และเมนูของเดสก์ท็อปอ่านจากที่นี่
// ใช้แค่เลือกว่าจะพาไปหน้าไหน / โชว์เมนูไหน · สิทธิ์จริงตรวจที่ API ทุกครั้ง
type Role = User['role'];

// staff / admin ใช้หน้าเดียวกัน: admin ได้สิทธิ์ของ staff ทั้งหมดที่ API (DESIGN 4.2)
export const HOME: Record<Role, string> = { student: '/report', technician: '/jobs', staff: '/queue', admin: '/queue' };

// หน้าจัดการผู้ใช้ของ admin — staff แก้ได้แค่ห้องพัก (DESIGN 7) ถ้าเปิดหน้านี้ให้ staff จะเห็นปุ่มเปลี่ยนบทบาทที่ API ตอบ 403
// สวิตช์ "ความเห็นภายใน" — นักศึกษาไม่เห็นและเขียนไม่ได้ (DESIGN 4.3) ถ้าโชว์สวิตช์ให้นักศึกษา กดแล้ว API ตอบ 403
export const canWriteInternal = (role: Role | undefined): boolean => role !== undefined && role !== 'student';

// หน้าพิมพ์ QR — API /assets/:id/qr เป็นของ staff / admin (เจ้าหน้าที่เป็นคนติดสติกเกอร์)
export const canPrintQr = (role: Role | undefined): boolean => role === 'staff' || role === 'admin';

export const canManageUsers = (role: Role | undefined): boolean => role === 'admin';
