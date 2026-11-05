import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { DEFAULT_CODE } from './common/errors/http-error.filter';

// เอกสาร OpenAPI ชุดเดียวที่ /docs เสิร์ฟ และที่ type ของหน้าเว็บสร้างจาก (web/src/api/schema.gen.ts)
// ถ้าสร้างสองที่ type ของหน้าเว็บจะตรงกับเอกสารคนละชุดกับที่ API ใช้จริง
export const buildOpenApi = (app: INestApplication): OpenAPIObject =>
  withErrorBodies(
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ระบบแจ้งซ่อมหอพักมหาวิทยาลัย')
        .setDescription(
          'Backend REST API — NestJS + PostgreSQL\n\n' +
            'error ทุกตัวตอบ body รูปเดียวกัน `{ statusCode, error, code, message, details? }` — ' +
            'แยกกรณีด้วย `code` เสมอ ไม่ใช่ด้วยข้อความ · ลำดับการตรวจ: role (403) → ownership (403) → สถานะ (409)',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    ),
  );

export const ERROR_SCHEMA = 'ErrorBody';

// code ของ 400 ที่พบบ่อยที่สุดคือ validate ไม่ผ่าน (ValidationException) ไม่ใช่ BAD_REQUEST ของ Nest
const DOC_DEFAULT_CODE: Record<string, string> = { ...DEFAULT_CODE, 400: 'VALIDATION_FAILED' };

// code ที่ขึ้นต้นคำอธิบาย เช่น "INVALID_TRANSITION หรือ ALREADY_ASSIGNED" → ตัวอย่างใช้ตัวแรก
const CODE_IN_TEXT = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

// ใส่ schema ของ error body (DESIGN 8) ให้ทุก response 4xx ที่ประกาศไว้ด้วย decorator ที่เดียว
// ถ้าให้แต่ละ endpoint เขียน schema เอง วันหนึ่งจะมีตัวที่ลืม แล้วผู้อ่านเอกสารไม่รู้ว่า error มี code ให้แยกกรณี
const withErrorBodies = (doc: OpenAPIObject): OpenAPIObject => {
  doc.components ??= {};
  doc.components.schemas ??= {};
  doc.components.schemas[ERROR_SCHEMA] = {
    type: 'object',
    required: ['statusCode', 'error', 'code', 'message'],
    properties: {
      statusCode: { type: 'integer', example: 409 },
      error: { type: 'string', example: 'Conflict' },
      code: { type: 'string', example: 'INVALID_TRANSITION', description: 'ค่าคงที่ให้ client แยกกรณี' },
      message: { type: 'string', example: 'ใบนี้เปลี่ยนสถานะไปแล้ว', description: 'ข้อความภาษาไทยให้ผู้ใช้อ่าน' },
      details: { description: 'ข้อมูลเพิ่มของบาง code เช่น skipped, tickets, retry_after, ช่องที่ผิด' },
    },
  };
  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item)) {
      const responses = (op as { responses?: Record<string, { description?: string; content?: unknown }> }).responses;
      for (const [status, res] of Object.entries(responses ?? {})) {
        if (!status.startsWith('4') || res.content) continue;
        const code = CODE_IN_TEXT.exec(res.description ?? '')?.[0] ?? DOC_DEFAULT_CODE[status] ?? `HTTP_${status}`;
        res.content = {
          'application/json': {
            schema: { $ref: `#/components/schemas/${ERROR_SCHEMA}` },
            example: { statusCode: Number(status), code, message: res.description || code },
          },
        };
      }
    }
  }
  return doc;
};
