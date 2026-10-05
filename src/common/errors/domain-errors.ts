import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

// รูปแบบ body คงที่ทั้งระบบ (DESIGN หัวข้อ 8)
//   message = ข้อความภาษาไทยให้ผู้ใช้อ่าน · code = ค่าคงที่ให้ client แยกกรณีด้วยโปรแกรม
export interface ErrorBody {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  details?: unknown;
}

export const errorBody = (statusCode: number, code: string, message: string, details?: unknown): ErrorBody => ({
  statusCode,
  error: STATUS_CODES[statusCode] ?? 'Error',
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

export class ValidationFailed extends AppException {
  constructor(details: { field: string; reason: string }[]) {
    super(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', details);
  }
}

export class InvalidTransition extends AppException {
  constructor(from: string, to: string) {
    super(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `เปลี่ยนสถานะจาก ${from} ไป ${to} ไม่ได้`, { from, to });
  }
}

export class NoteRequired extends AppException {
  constructor(status: string) {
    super(HttpStatus.BAD_REQUEST, 'NOTE_REQUIRED', 'ต้องระบุหมายเหตุ', { status });
  }
}
