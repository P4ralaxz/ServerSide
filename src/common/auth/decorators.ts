import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { User } from '../../database/entities';
import { UserRole } from '../../domain/enums';

export const IS_PUBLIC = 'isPublic';
// ทุก endpoint ต้องมี token เป็นค่าเริ่มต้น — endpoint ที่เปิดให้คนนอกต้องประกาศเองอย่างตั้งใจ
// (ถ้ากลับด้านเป็น "ใส่ guard ทีละตัว" endpoint ที่ลืมใส่จะเปิดโล่งโดยไม่มีอะไรเตือน)
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
// ชั้น 1 ของการเช็คสิทธิ์ (role → 403) — ownership และ state อยู่ใน service
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

// user ที่ JwtAuthGuard โหลดจาก DB ใน request นี้ — ไม่ใช่ข้อมูลจาก token
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest<{ user: User }>().user,
);
