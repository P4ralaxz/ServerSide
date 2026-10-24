import { readFileSync } from 'node:fs';
import { currentWebSchema, WEB_SCHEMA_FILE } from './web-types';

// UI-PLAN 7: type ของ response ฝั่งหน้าเว็บต้องตรงกับ DTO ฝั่ง backend
// แดง = แก้ DTO แล้วไม่ได้สร้าง type ใหม่ → รัน `npm run web:types` แล้วให้ web:typecheck บอกว่าหน้าไหนต้องแก้
describe('type ของหน้าเว็บ ↔ Swagger', () => {
  it('web/src/api/schema.gen.ts ตรงกับ Swagger ปัจจุบันทุกตัวอักษร', async () => {
    const committed = readFileSync(WEB_SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(await currentWebSchema());
  });
});
