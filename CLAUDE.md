# ระบบแจ้งซ่อมหอพักมหาวิทยาลัย — NestJS + PostgreSQL

Backend REST API วิชา Information Technology คณะ IT KMITL (30% ของเกรด)
นำเสนอออนไลน์ **12–13 พฤศจิกายน 2569**

ระบบนี้เขียนใหม่ด้วย TypeScript จากเวอร์ชัน Python/FastAPI เดิม
**ไม่ใช่การพอร์ตตรง ๆ** — แก้ช่องโหว่ที่พบจากการวิเคราะห์ของเดิมไปด้วย

---

## ไฟล์และ repo

| ที่ | บทบาท |
|---|---|
| repo นี้ `P4ralaxz/ServerSide` | โค้ดทั้งหมดของเวอร์ชันใหม่ เริ่มจาก repo ว่าง |
| `DESIGN-maintenance-nestjs.md` (root, **ไม่ commit**) | **แหล่งความจริงของการออกแบบ** — schema, status machine, flow, API, แผนงาน |
| `P4ralaxz/ServerSide-0` commit `4f1c980` | ของเดิม Python — **อ่านอย่างเดียว** ใช้เทียบกฎและตอบข้อ [เทียบของเดิม] |

ลำดับความสำคัญ: **DESIGN > CLAUDE.md > โค้ดเดิม**
ถ้าไฟล์นี้กับ DESIGN ขัดกัน ให้ยึด DESIGN แล้วแจ้งผมว่าตรงไหนขัด

เปิดของเดิมดู (ห้าม commit/push ไปที่ ServerSide-0 และห้ามคัดลอกโค้ด Python มาทั้งไฟล์)

```bash
git clone git@github.com:P4ralaxz/ServerSide-0.git ../ServerSide-0   # ครั้งแรกครั้งเดียว
git -C ../ServerSide-0 show 4f1c980:db/schema.sql
git -C ../ServerSide-0 show 4f1c980:app/core/enums.py
git -C ../ServerSide-0 ls-tree -r --name-only 4f1c980 tests/
```

ไฟล์เดิมที่มีประโยชน์: `db/schema.sql` · `app/core/enums.py` · `app/services/permissions.py` ·
`app/services/ticket_status.py` · `tests/` (252 เคส ชื่อเทสบอกกฎ) · `app/web/scan.html` · `UPDATE-W2..W5.txt`

---

## สแตก

NestJS 10 · TypeScript (strict) · Node 20+ · PostgreSQL 16 · TypeORM (`synchronize: false`, migration เป็น SQL ล้วน) ·
class-validator · @nestjs/swagger (`/docs`) · @nestjs/jwt · @nestjs/throttler · @nestjs/schedule ·
nodemailer (dev: Mailpit) · Jest + supertest + Testcontainers

---

## กฎทางธุรกิจที่ห้ามละเมิด

เป็นเคลมในรายงานและจะถูกถามตอนนำเสนอ รายละเอียดอยู่ใน DESIGN หัวข้อ 3–6

1. **1 ticket = 1 ครุภัณฑ์ / 1 ปัญหา** — ห้ามมีตาราง `ticket_items`
   แจ้งหลายรายการ = รับ `items[]` สร้างหลายใบผูก `batch_id` เดียวกัน
2. **ช่างปิดงานเองไม่ได้** — ช่างไปได้สูงสุด `resolved`
   - ห้องพัก: student ที่พักห้องนั้นกด `/confirm` หรือ `/reopen` (Staff ทำแทนไม่ได้)
   - ส่วนกลาง: Staff กด `/confirm` หรือ `/reopen`
   - ไม่ยืนยันใน 3 วัน → ระบบปิดเอง `confirmed_by = NULL`, `close_reason = auto_closed`
   - ใบส่วนกลางที่มีคนกด same-issue หลัง resolved (`disputed_at`) → ระบบไม่ปิดเอง
3. **เช็คสิทธิ์ตามลำดับตายตัว**: role (403) → ownership (403) → state (409)
   ห้ามเช็คแจ้งซ้ำก่อน ownership (ข้อมูลห้องอื่นรั่วผ่าน 409)
   ownership ทั้งหมดอยู่ใน `TicketPolicy` ที่เดียว — ทั้ง "แตะได้" และ "เห็นได้" แก้คู่กันเสมอ
   ส่วนกลางเปิดทุกอาคาร **ห้าม** เพิ่มเงื่อนไขอาคารเดียวกัน
4. **ทุกการเปลี่ยนสถานะ**: lock แถว (`pessimistic_write`) + UPDATE + INSERT log ในทรานแซกชันเดียว
   `ticket_status_logs` เก็บเฉพาะการเปลี่ยนขั้นจริง — assign ซ้ำ/เลื่อนนัด/priority ไป `ticket_audit_logs`
5. **กันแจ้งซ้ำ**: DB บังคับด้วย `idx_tickets_asset_open` · batch ใช้ `INSERT … ON CONFLICT … WHERE … DO NOTHING`
   ซ้ำบางรายการ → 201 + `skipped[]` · ซ้ำทุกรายการ → 409
   same-issue: 1 คน 1 ครั้งผ่าน `ticket_reporters` · `report_count > 10` → `urgent`
6. **Passwordless เท่านั้น** — ห้ามมี `password_hash`
   OTP 6 หลัก เก็บเป็น HMAC, อายุ 10 นาที, ลองผิดเกิน 5 ครั้งรหัสใช้ไม่ได้
   JWT มีแค่ `sub` — guard โหลด user จาก DB ทุก request และเช็ค `is_active` / `deleted_at`

---

## ข้อตกลงในโค้ด

- **คอมเมนต์ภาษาไทย** อธิบาย *ทำไม* ไม่ใช่ *ทำอะไร*
- **ในทรานแซกชันใช้ `manager.getRepository()` เท่านั้น** ห้ามใช้ repository ที่ inject มา (หลุดทรานแซกชันโดยไม่มี error)
- **สถานะ**: `src/domain/status-rules.ts` เป็นแหล่งความจริงเดียว ห้าม hardcode เงื่อนไขซ้ำใน service
- **Soft delete**: query ทุกตัว รวมรายงานและ raw SQL ต้องมี `deleted_at IS NULL` (`@DeleteDateColumn` ไม่กรอง `manager.query()`)
- **เวลา**: `timestamptz` ทุกคอลัมน์, process ตั้ง `TZ=UTC`, ปี พ.ศ. ในเลขใบคิดตามเวลาไทยผ่าน `common/time/thai-year.ts` ที่เดียว
- **Endpoint แยกตามสิทธิ์**: `/assign` `/schedule` `/status` `/priority` `/reject` `/confirm` `/reopen` — ห้ามรวมเป็น `PUT /tickets/:id`
- **PUT** = แทนที่ทั้งรายการ · **PATCH** = แก้บางฟิลด์
- **Status code**: 400 validate · 401 ไม่มี token · 403 role/ownership · 404 ไม่พบหรือมองไม่เห็น · 409 ขัดกับสถานะ · 429 ถี่เกิน
  `POST /auth/request-code` ตอบ **202** ข้อความเดียวกันเสมอ
- **Error จาก Postgres** ผ่าน `DbErrorFilter` (23505→409, 23503/23514/22P02→400) — ห้ามให้หลุดเป็น 500
- path param ที่เป็น uuid ใช้ `ParseUUIDPipe` ทุกตัว
- Swagger decorator ครบทุก endpoint

---

## จุดที่พลาดง่าย

- `synchronize: true` จะสร้างตารางที่ดูเหมือนถูก แต่ partial index / trigger / view / CHECK หายไปเงียบ ๆ
- predicate ของ `idx_tickets_asset_open` ต้องตรงกับ `OPEN_STATUSES` — มี contract test เทียบ ห้ามลบเทสนั้น
- `OPEN_STATUSES` ห้ามรวม `closed` / `rejected`
- เวลาใน seed ต้องเดินตามไทม์ไลน์จริง ไม่งั้นรายงานเวลาค้างต่อขั้นเป็น 0 ทุกช่อง
- ทรานแซกชันที่เจอ unique violation จะ abort ทั้งก้อน — batch ห้ามพึ่ง try/catch 23505

---

## วิธีทำงานใน repo นี้

- ทำ **ทีละสัปดาห์** ตาม DESIGN หัวข้อ 11 จบแล้วสรุปสิ่งที่ทำ + ผลเทส แล้วหยุดรอ
- งานที่มี **[เทียบของเดิม]** → เปิดโค้ดเดิมดูก่อน แล้วบอกผลก่อนเขียน
- เรื่องใน DESIGN หัวข้อ 12 → **ถามผมก่อน** ห้ามตัดสินใจเอง
- DESIGN หัวข้อ 13 (แนบรูป) → **ห้ามเริ่ม** จนกว่าผมสั่ง และต้องทำหลังสัปดาห์ 6 เสร็จ
- โมดูลจะ "เสร็จ" เมื่อ: เทสผ่านบน Postgres จริง **และ** ลองแก้โค้ดให้ผิดกฎแล้วเทสแดง (mutation check ตาม DESIGN หัวข้อ 10)
- ห้าม commit: `DESIGN-maintenance-nestjs.md`, `.env`, `uploads/`
- commit เล็ก ๆ ต่อเรื่อง ข้อความภาษาอังกฤษรูปแบบ `feat:` / `fix:` / `test:` / `chore:`

## คำสั่ง

```bash
docker compose up -d          # postgres (:5434) + mailpit (http://localhost:8026)
npm run migration:run
npm run seed
npm run start:dev             # http://localhost:3100/docs
npm test                      # unit
npm run test:e2e              # e2e บน Testcontainers (ต้องเปิด Docker)
```

(สัปดาห์ 1 ต้องสร้างสคริปต์เหล่านี้ให้ใช้ได้จริงตามชื่อข้างบน)
