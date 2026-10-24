import '../../src/common/time/utc';
import { NestFactory } from '@nestjs/core';
import { OpenAPIObject } from '@nestjs/swagger';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module';
import { buildOpenApi } from '../../src/swagger';

// type ของ response ที่หน้าเว็บใช้ สร้างจาก Swagger ชุดเดียวกับ /docs (UI-PLAN 7)
// ถ้าเขียน type ฝั่งหน้าเว็บเอง วันที่ DTO เปลี่ยน หน้าเว็บจะ build ผ่านแต่อ่าน field ที่ไม่มีแล้ว
// web/src/api/schema.gen.ts เป็นผลของไฟล์นี้ — contract test เทียบทุกครั้ง ต่างแม้ตัวอักษรเดียวก็แดง

export const WEB_SCHEMA_FILE = join(__dirname, '..', '..', 'web', 'src', 'api', 'schema.gen.ts');

interface Schema {
  type?: string;
  format?: string;
  enum?: unknown[];
  nullable?: boolean;
  items?: Schema;
  $ref?: string;
  allOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
}

const refName = (ref: string): string => ref.slice(ref.lastIndexOf('/') + 1);

const typeOf = (s: Schema): string => {
  let t: string;
  if (s.$ref) t = refName(s.$ref);
  else if (s.allOf?.length === 1 && s.allOf[0].$ref) t = refName(s.allOf[0].$ref);
  else if (s.enum) t = s.enum.map((v) => `'${String(v)}'`).join(' | ');
  else if (s.type === 'array') {
    const inner = typeOf(s.items ?? {});
    t = /[ |]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
  } else if (s.type === 'string')
    t = 'string'; // date-time มาเป็น string ใน JSON
  else if (s.type === 'number' || s.type === 'integer') t = 'number';
  else if (s.type === 'boolean') t = 'boolean';
  else if (s.type === 'object' && !s.properties) t = 'Record<string, unknown>';
  else t = 'unknown';
  return s.nullable ? `${t} | null` : t;
};

export const renderWebSchema = (doc: OpenAPIObject): string => {
  const schemas = (doc.components?.schemas ?? {}) as Record<string, Schema>;
  const out = [
    '// ไฟล์นี้สร้างจาก Swagger ของ backend ด้วย `npm run web:types` — ห้ามแก้เอง',
    '// test/contract/web-types.spec.ts เทียบไฟล์นี้กับ DTO ปัจจุบันทุกครั้งที่รัน test:e2e',
    '',
  ];
  for (const name of Object.keys(schemas).sort()) {
    const s = schemas[name];
    if (!s.properties) {
      out.push(`export type ${name} = ${typeOf(s)};`, '');
      continue;
    }
    const required = new Set(s.required ?? []);
    out.push(`export interface ${name} {`);
    for (const [prop, ps] of Object.entries(s.properties)) {
      out.push(`  ${prop}${required.has(prop) ? '' : '?'}: ${typeOf(ps)};`);
    }
    out.push('}', '');
  }
  return out.join('\n');
};

// preview: ไม่สร้าง provider และไม่ต่อ DB — Swagger อ่านแค่ metadata ของ controller/DTO
export const currentWebSchema = async (): Promise<string> => {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  try {
    return renderWebSchema(buildOpenApi(app));
  } finally {
    await app.close();
  }
};
