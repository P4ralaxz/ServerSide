import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../../src/app.module';
import { buildOpenApi, ERROR_SCHEMA } from '../../src/swagger';

// Swagger ครบทุก endpoint (สัปดาห์ 6) — เอกสารที่ /docs ใช้ตอนนำเสนอและเป็นที่มาของ type หน้าเว็บ
// mutation check: ลบ @ApiBadRequestResponse ของ endpoint ที่มี body / ลบ example ของ field ข้อความ → เทสนี้แดง

interface Op {
  summary?: string;
  security?: unknown[];
  requestBody?: unknown;
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string }; example?: { code?: string } }> }>;
}

describe('Swagger', () => {
  let doc: OpenAPIObject;
  const ops: { name: string; path: string; op: Op }[] = [];

  beforeAll(async () => {
    // preview: ไม่สร้าง provider และไม่ต่อ DB — Swagger อ่านแค่ metadata ของ controller/DTO
    const app: INestApplication = await NestFactory.create(AppModule, { preview: true, logger: false });
    doc = buildOpenApi(app);
    await app.close();
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) ops.push({ name: `${method.toUpperCase()} ${path}`, path, op });
    }
  });

  const missing = (check: (o: { path: string; op: Op }) => boolean) => ops.filter((o) => !check(o)).map((o) => o.name);

  it('ทุก endpoint มีคำอธิบายและ response สำเร็จ', () => {
    expect(ops.length).toBeGreaterThan(40);
    expect(missing(({ op }) => Boolean(op.summary))).toEqual([]);
    expect(missing(({ op }) => Object.keys(op.responses).some((c) => c.startsWith('2')))).toEqual([]);
  });

  it('endpoint ที่ต้องใช้ token มี 401 · มี body มี 400 · มี :id มี 404', () => {
    expect(missing(({ op }) => !op.security || '401' in op.responses)).toEqual([]);
    expect(missing(({ op }) => !op.requestBody || '400' in op.responses)).toEqual([]);
    expect(missing(({ path, op }) => !path.includes('{id}') || '404' in op.responses)).toEqual([]);
  });

  it('ทุก response 4xx มี error body (DESIGN 8) พร้อมตัวอย่าง code', () => {
    const bad: string[] = [];
    for (const { name, op } of ops) {
      for (const [status, res] of Object.entries(op.responses)) {
        if (!status.startsWith('4')) continue;
        const json = res.content?.['application/json'];
        if (
          json?.schema?.$ref !== `#/components/schemas/${ERROR_SCHEMA}` ||
          !/^[A-Z][A-Z0-9_]+$/.test(json.example?.code ?? '')
        ) {
          bad.push(`${name} ${status}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('ทุก field ข้อความ (ไม่ใช่ uuid / วันเวลา / enum) มีตัวอย่าง', () => {
    const bad: string[] = [];
    for (const [schema, s] of Object.entries(doc.components?.schemas ?? {})) {
      for (const [prop, p] of Object.entries(
        (s as { properties?: Record<string, Record<string, unknown>> }).properties ?? {},
      )) {
        const plain = p.type === 'string' && !p.enum && !['uuid', 'date-time', 'binary'].includes(String(p.format));
        if (plain && p.example === undefined) bad.push(`${schema}.${prop}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
