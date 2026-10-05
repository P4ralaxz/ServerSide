import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { errorBody } from './domain-errors';

interface Mapping {
  status: number;
  code: string;
  message: string;
}

// error ของ Postgres ที่หลุดมาถึง controller — ห้ามให้กลายเป็น 500
const SQLSTATE: Record<string, Mapping> = {
  '23505': { status: 409, code: 'UNIQUE_VIOLATION', message: 'ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว' },
  '23503': {
    status: 400,
    code: 'FOREIGN_KEY_VIOLATION',
    message: 'อ้างถึงข้อมูลที่ไม่มีอยู่ หรือยังมีข้อมูลอื่นอ้างถึงรายการนี้',
  },
  '23514': { status: 400, code: 'CHECK_VIOLATION', message: 'ข้อมูลไม่ผ่านเงื่อนไขของระบบ' },
  '22P02': { status: 400, code: 'INVALID_INPUT', message: 'รูปแบบข้อมูลไม่ถูกต้อง' },
  // ให้ client ลองใหม่ได้ — ไม่ใช่ความผิดของคำขอ
  '40001': { status: 409, code: 'RETRY_TRANSACTION', message: 'มีการแก้ไขพร้อมกัน กรุณาลองใหม่' },
  '40P01': { status: 409, code: 'RETRY_TRANSACTION', message: 'มีการแก้ไขพร้อมกัน กรุณาลองใหม่' },
};

@Catch(QueryFailedError)
export class DbErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DbErrorFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const driver = exception.driverError as { code?: string; constraint?: string };
    const hit = driver.code ? SQLSTATE[driver.code] : undefined;

    if (!hit) {
      this.logger.error(`SQLSTATE ${driver.code ?? '?'}: ${exception.message}`, exception.stack);
      res.status(500).json(errorBody(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ'));
      return;
    }

    // ส่งแค่ชื่อ constraint — ข้อความ detail ของ Postgres มีค่าในแถวที่ชนติดมาด้วย (ข้อมูลของคนอื่นรั่วได้)
    const details = driver.constraint ? { constraint: driver.constraint } : undefined;
    res.status(hit.status).json(errorBody(hit.status, hit.code, hit.message, details));
  }
}
