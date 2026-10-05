import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { User } from '../../database/entities';
import { AppException } from '../errors/domain-errors';
import { IS_PUBLIC } from './decorators';

const unauthorized = (): AppException => new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let sub: unknown;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub?: unknown }>(token, { algorithms: ['HS256'] }));
    } catch {
      throw unauthorized();
    }
    // sub ที่ไม่ใช่ uuid จะทำให้ Postgres โยน 22P02 → กลายเป็น 400 แทน 401
    if (typeof sub !== 'string' || !isUUID(sub)) throw unauthorized();

    // โหลดจาก DB ทุก request: token มีแค่ sub จึงไม่มี role/สถานะเก่าค้างอยู่ใน token
    // ระงับบัญชี ลบบัญชี หรือเปลี่ยน role มีผลกับ request ถัดไปทันที ไม่ต้องรอ token หมดอายุ
    // (findOne ข้ามแถวที่ deleted_at ไม่ว่างให้เองผ่าน @DeleteDateColumn)
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: sub } });
    if (!user || !user.isActive) throw unauthorized();

    req.user = user;
    return true;
  }
}
