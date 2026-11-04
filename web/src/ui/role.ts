import type { User } from '../api/types';

// การแปลงบทบาทเป็นข้อความอยู่ที่ไฟล์นี้ที่เดียว — เหมือน status.ts ของสถานะ
type Role = User['role'];

export const ROLES: readonly Role[] = ['student', 'technician', 'staff', 'admin'];

const LABEL: Record<Role, string> = { student: 'นักศึกษา', technician: 'ช่าง', staff: 'Staff', admin: 'Admin' };
export const roleLabel = (r: Role): string => LABEL[r];

// ตัวกรองบทบาทของหน้าผู้ใช้ — '' = ทุกบทบาท
export const matchesRole = (r: Role, filter: Role | ''): boolean => filter === '' || r === filter;

// ผูกห้องพักได้เฉพาะนักศึกษา: ช่างห้ามมีห้อง (ck_technician_no_room) · Staff / Admin ไม่ได้พักในหอ
export const livesInRoom = (r: Role): boolean => r === 'student';
