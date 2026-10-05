import { HttpStatus } from '@nestjs/common';
import { AppException } from './domain-errors';

// ตัวช่วยสร้าง error ตามตาราง status code ใน CLAUDE.md
// 400 validate · 403 role/ownership · 404 ไม่พบหรือมองไม่เห็น · 409 ขัดกับสถานะ
export const badRequest = (code: string, message: string, details?: unknown): AppException =>
  new AppException(HttpStatus.BAD_REQUEST, code, message, details);

export const forbidden = (message = 'ไม่มีสิทธิ์ทำรายการนี้', details?: unknown): AppException =>
  new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message, details);

export const notFound = (message = 'ไม่พบข้อมูล'): AppException =>
  new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);

export const conflict = (code: string, message: string, details?: unknown): AppException =>
  new AppException(HttpStatus.CONFLICT, code, message, details);
