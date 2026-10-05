import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '../../database/entities';
import { UserRole } from '../../domain/enums';
import { AppException } from '../errors/domain-errors';
import { ROLES } from './decorators';

// ชั้น 1: role → 403 — ต้องรันหลัง JwtAuthGuard เสมอ (ลำดับกำหนดใน AppModule)
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;

    // role อ่านจาก user ที่เพิ่งโหลดจาก DB ไม่ใช่จาก token
    const user = ctx.switchToHttp().getRequest<{ user?: User }>().user;
    if (!user || !roles.includes(user.role)) {
      throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'ไม่มีสิทธิ์ทำรายการนี้');
    }
    return true;
  }
}
