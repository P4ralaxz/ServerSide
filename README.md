# ระบบแจ้งซ่อมหอพักมหาวิทยาลัย

นักศึกษาสแกน QR ที่ติดบนของที่เสีย แจ้งซ่อมได้ในไม่ถึงนาที แล้วติดตามได้ทุกขั้นจนซ่อมหายจริง
ช่างเห็นงานของตัวเองเป็นกลุ่ม · เจ้าหน้าที่มีคิวงานที่บอกว่าอะไรต้องทำก่อน · ผู้ดูแลมีรายงานว่างานติดอยู่ตรงไหน

Backend REST API + หน้าเว็บ — วิชา Server-Side, คณะเทคโนโลยีสารสนเทศ สจล. (KMITL) ปีการศึกษา 2569

ผู้จัดทำ: 67070017 · 67070053 · 67070097

---

## ฟีเจอร์หลัก

| ผู้ใช้ | ทำอะไรได้ |
|---|---|
| **นักศึกษา** | login ด้วยรหัส 6 หลักทางอีเมล KMITL (ไม่มีรหัสผ่าน) · สแกน QR แล้วแจ้งซ่อม · แจ้งหลายชิ้นในห้องเดียวกันครั้งเดียว · กด "เจอปัญหาเดียวกัน" กับของส่วนกลาง · ยืนยันว่าหายแล้ว หรือกด "ยังไม่หาย" พร้อมเหตุผล |
| **ช่าง** | งานของฉันแยกกลุ่ม: ถูกส่งกลับ · นัดวันนี้ · รออะไหล่ · เริ่มงาน / ซ่อมเสร็จ / รออะไหล่ (ต้องบอกว่ารออะไร) · ความเห็นภายในที่ผู้พักไม่เห็น |
| **เจ้าหน้าที่ (Staff)** | คิวงานพร้อมตัวกรองและตัวเลข · มอบหมาย / นัด / ปรับความด่วน / ปฏิเสธ · ยืนยันใบส่วนกลาง · พิมพ์ QR ทั้งห้องในแผ่นเดียว · รายงาน |
| **ผู้ดูแล (Admin)** | จัดการผู้ใช้และบทบาท · อาคาร ห้อง ครุภัณฑ์ · สั่งรันงานปิดอัตโนมัติ |

### กฎที่ระบบบังคับ

- **1 ใบ = ของ 1 ชิ้น / 1 ปัญหา** — แจ้งหลายรายการได้ในครั้งเดียว ระบบสร้างหลายใบผูกชุดเดียวกัน
- **ของชิ้นหนึ่งมีใบที่เปิดอยู่ได้ใบเดียว** — ฐานข้อมูลบังคับด้วย partial unique index กดพร้อมกันก็ได้ใบเดียว
- **ช่างปิดใบเองไม่ได้** — ช่างไปได้สูงสุด "ซ่อมเสร็จ รอยืนยัน"
  ห้องพัก: ผู้พักห้องนั้นเป็นคนยืนยัน · ส่วนกลาง: Staff ยืนยัน
- **ไม่ยืนยันใน 3 วัน → ระบบปิดให้** และบันทึกว่าระบบเป็นคนปิด · ใบส่วนกลางที่มีคนแย้งว่ายังไม่หาย ระบบไม่ปิดเอง
- **คนที่ 11 กด "เจอปัญหาเดียวกัน" → ด่วนมากอัตโนมัติ** (1 คนนับได้ครั้งเดียว)
- **ความเป็นส่วนตัว** — ผู้พักเลือกได้ว่าให้ช่างเข้าตอนไม่อยู่หรือไม่ · คนห้องอื่นสแกน QR ห้องเราจะไม่เห็นใบของเรา
- **เช็คสิทธิ์ตามลำดับตายตัว**: บทบาท (403) → ความเป็นเจ้าของ (403) → สถานะ (409) — ข้อมูลห้องอื่นไม่รั่วผ่าน error
- **ทุกการเปลี่ยนสถานะ** lock แถว + อัปเดต + บันทึกประวัติ ในทรานแซกชันเดียว

---

## สแตก

| ส่วน | ใช้ |
|---|---|
| Backend | NestJS 10 · TypeScript (strict) · Node 20+ |
| ฐานข้อมูล | PostgreSQL 16 · TypeORM (`synchronize: false`, migration เป็น SQL ล้วน) |
| Auth | OTP 6 หลักทางอีเมล (เก็บเป็น HMAC) · JWT |
| อื่น ๆ | class-validator · Swagger · @nestjs/throttler · @nestjs/schedule · nodemailer |
| Frontend | React + Vite (`web/`) — Nest เสิร์ฟหน้าเว็บที่ `/app` |
| เทส | Jest + supertest + Testcontainers (Postgres จริง) · Playwright |
| Dev | Docker Compose (Postgres + Mailpit สำหรับดูเมล OTP) |

---

## เริ่มใช้งาน

ต้องมี **Node 20+** และ **Docker Desktop**

```bash
# 1. ติดตั้ง
npm install
npm --prefix web install

# 2. ตั้งค่า — คัดลอกแล้วแก้ค่าตามคอมเมนต์ในไฟล์
cp .env.example .env

# 3. เปิดฐานข้อมูลและ Mailpit
docker compose up -d

# 4. สร้างตาราง + ข้อมูลตัวอย่าง (ล้างข้อมูลเดิมทั้งหมด)
npm run migration:run
npm run seed

# 5. รัน
npm run web:build
npm run start:dev
```

| ที่อยู่ | คืออะไร |
|---|---|
| http://localhost:3100/app | หน้าเว็บ |
| http://localhost:3100/docs | Swagger (เอกสาร API ทุก endpoint) |
| http://localhost:8026 | Mailpit — ดูเมลรหัส OTP ตอน dev |

ตั้งผู้ดูแลคนแรก: `npm run user:make-admin -- you@kmitl.ac.th`

### ข้อมูลเดโมสำหรับทีม

```bash
npm run seed -- 67070017@kmitl.ac.th 67070053@kmitl.ac.th 67070097@kmitl.ac.th
```

แต่ละอีเมลได้บัญชีครบทุกบทบาทแบบ plus-address (เช่น `67070017+student1@kmitl.ac.th`, `+tech1`, `+staff1`, `+admin1`) รหัส login เข้าเมลของเจ้าของจริง
ลำดับการเดโมทั้งหมดอยู่ที่ [docs/demo.md](docs/demo.md)

### ส่งเมลจริง / เปิดให้คนนอกเข้า

- ตั้งค่า SMTP ของผู้ให้บริการเมลใน `.env` (ตัวอย่าง Gmail อยู่ใน `.env.example`) แล้วลองด้วย `npm run mail:test -- you@kmitl.ac.th`
- รันหลัง tunnel (ngrok / cloudflared): ตั้ง `APP_BASE_URL` เป็นลิงก์ tunnel (QR ชี้ตามค่านี้) และ `TRUST_PROXY=true`

---

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run start:dev` | รัน API แบบ watch |
| `npm run build` · `npm run start:prod` | build แล้วรันแบบ production |
| `npm run web:dev` · `npm run web:build` | รัน / build หน้าเว็บ |
| `npm run migration:run` · `migration:revert` | รัน / ย้อน migration |
| `npm run seed` | ล้างและสร้างข้อมูลตัวอย่างใหม่ |
| `npm test` | unit test |
| `npm run test:e2e` | e2e ของ API บน Postgres จริงผ่าน Testcontainers (ต้องเปิด Docker) |
| `npm run web:e2e` | Playwright — เดินหน้าเว็บจริงทุกบทบาท รวมลำดับเดโม |
| `npm run typecheck` · `npm run lint` | ตรวจ type และ lint (`web:typecheck` · `web:lint` สำหรับหน้าเว็บ) |

---

## โครงสร้าง

```
src/
  domain/status-rules.ts   สถานะและการเปลี่ยนสถานะทั้งหมด — แหล่งความจริงเดียว
  modules/
    auth/                  OTP, JWT, guard
    tickets/               แจ้งซ่อม, workflow, สิทธิ์ (TicketPolicy), ความเห็น, ปิดอัตโนมัติ
    scan/  assets/         หน้าหลังสแกน QR, ครุภัณฑ์และ QR
    rooms/ buildings/ users/ reports/ admin/ health/
  database/
    migrations/            SQL ล้วน (partial index, trigger, CHECK)
    seed/                  ข้อมูลตัวอย่าง + บัญชีทีม
  common/                  error filter, เวลา/ปี พ.ศ., ตัวช่วยร่วม
  cli/                     make-admin, mail-test, demo-accounts
web/
  src/                     React — หน้าของนักศึกษา ช่าง Staff Admin
  e2e/                     Playwright + ภาพต้นแบบสำหรับเทียบหน้าจอ
test/
  e2e/                     เทส API บน Postgres จริง
  contract/                เทียบสัญญา (index ↔ OPEN_STATUSES, Swagger, type ของหน้าเว็บ)
  PARITY.md                ตารางเทียบเทสกับเวอร์ชัน Python เดิม
docs/demo.md               ลำดับการเดโม
```

---

## การทดสอบ

- **808 เคส** ผ่านทั้งหมด: unit 83 · API e2e 675 · หน้าเว็บ (Playwright) 50
- e2e รันบน **PostgreSQL จริง** (Testcontainers) ไม่ใช่ฐานข้อมูลจำลอง — partial index, trigger และ lock ถูกทดสอบจริง
- **Mutation check 24 แบบ** — แก้โค้ดให้ผิดกฎทีละข้อ (เช่น ให้ช่างปิดใบได้, ข้ามการเช็คความเป็นเจ้าของ) แล้วยืนยันว่าเทสแดงทุกครั้ง
- `web/e2e/14-demo.spec.ts` เดินตาม [docs/demo.md](docs/demo.md) ทุกขั้น — ถ้าเทสผ่าน ลำดับเดโมใช้ได้กับ seed ปัจจุบัน
- เทียบกับเทส 252 เคสของเวอร์ชัน Python เดิม: แปลแล้ว 241 เคส ที่เหลือเป็นฟีเจอร์ที่ตัดออกโดยตั้งใจ — ดู [test/PARITY.md](test/PARITY.md)
