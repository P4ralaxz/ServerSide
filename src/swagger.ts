import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

// เอกสาร OpenAPI ชุดเดียวที่ /docs เสิร์ฟ และที่ type ของหน้าเว็บสร้างจาก (web/src/api/schema.gen.ts)
// ถ้าสร้างสองที่ type ของหน้าเว็บจะตรงกับเอกสารคนละชุดกับที่ API ใช้จริง
export const buildOpenApi = (app: INestApplication): OpenAPIObject =>
  SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ระบบแจ้งซ่อมหอพักมหาวิทยาลัย')
      .setDescription('Backend REST API — NestJS + PostgreSQL')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
