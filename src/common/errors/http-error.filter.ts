import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppException, errorBody } from './domain-errors';

const DEFAULT_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

// จับทุกอย่างที่ไม่มี filter เฉพาะ เพื่อให้ body เป็นรูปเดียวกันทั้งระบบ
// (exception ของ Nest เองตอบ { statusCode, message, error } ซึ่งไม่มี code ให้หน้าเว็บแยกกรณี)
// รวม 401/403 ที่ guard โยนด้วย — filter ระดับ global ครอบ guard อยู่แล้ว
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      const status = exception.getStatus();
      const retryAfter = (exception.details as { retry_after?: unknown } | undefined)?.retry_after;
      if (status === 429 && typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
      res.status(status).json(errorBody(status, exception.code, exception.message, exception.details));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const msg = typeof raw === 'object' && raw !== null ? (raw as { message?: unknown }).message : raw;
      const message = Array.isArray(msg) ? msg.join(', ') : String(msg ?? exception.message);
      res.status(status).json(errorBody(status, DEFAULT_CODE[status] ?? `HTTP_${status}`, message));
      return;
    }

    // ไม่ส่งรายละเอียดออกไป — stack อาจมี SQL หรือ path ของเครื่อง
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json(errorBody(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ'));
  }
}
