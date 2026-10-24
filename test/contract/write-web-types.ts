import { writeFileSync } from 'node:fs';
import { currentWebSchema, WEB_SCHEMA_FILE } from './web-types';

// npm run web:types — เขียน web/src/api/schema.gen.ts ใหม่หลังแก้ DTO
void currentWebSchema().then((text) => {
  writeFileSync(WEB_SCHEMA_FILE, text);
  console.log(`เขียน ${WEB_SCHEMA_FILE} แล้ว`);
});
