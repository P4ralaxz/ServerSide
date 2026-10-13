# Prompt สำหรับ Claude Code (สัปดาห์ 4 ถึงจบ)

ใช้ทีละช่วง ส่งช่วงถัดไปหลังจากผมอ่านสรุปของช่วงก่อนแล้วเท่านั้น
กฎ "ถ้าเจอปัญหา" และรูปแบบสรุปจบช่วง ย้ายไปอยู่ใน CLAUDE.md หัวข้อ "วิธีทำงานใน repo นี้" แล้ว — ทุกช่วงใช้ชุดเดียวกัน

---

## สัปดาห์ 4 — workflow

```
เริ่มสัปดาห์ 4 ตาม UI-PLAN.md หัวข้อ 8

ก่อนเริ่ม:
1. อ่าน DESIGN-PATCH-W4.md แล้วรวมเข้า DESIGN ทีละหัวข้อ (ห้ามเขียนทับทั้งไฟล์)
   ถ้าหัวข้อไหนขัดกับ DESIGN ปัจจุบันหรือโค้ดที่ทำไปแล้ว ให้หยุดถาม
   แสดง diff ของ DESIGN มาให้ผมดู แล้วรอผมตอบ ok ก่อนเขียนโค้ด
2. อ่าน UI-PLAN.md หัวข้อ 4 (ข้อมูลที่หน้าจอต้องได้จาก API) และเปิด docs/ui/mockup.html ดูว่าหน้าจอจะใช้ field ไหน

ขอบเขต:
- endpoint: /assign, /schedule, /status, /priority, /reject, /confirm, /cancel
  ตาม DESIGN-PATCH P1–P6 (ใช้ transition() ตัวเดียวกันทุก endpoint)
- role hierarchy admin ⊇ staff ที่ RolesGuard / actorOf() ที่เดียว (P1)
- audit log ของ assign / reassign / schedule / priority
- side effects ตามตาราง P2
- แจ้งเตือนทางอีเมลตอน resolved (P7)
- ฟิลด์ actions ทั้งใน GET /tickets/:id และแต่ละรายการของ GET /tickets + contract test (P8)
- field ที่หน้าจอใช้ (P15): assignee, report_count, reopen_count, last_reopen_note, scheduled_at,
  permission_to_enter, auto_close_at โดย GET /tickets ห้าม query เพิ่มต่อแถว
- P16: เช็คว่า POST /tickets บังคับ description และ title มาจากไหน แล้วรายงาน (ยังไม่ต้องแก้)
- GET /tickets/:id/history (P9)
- seed: เพิ่ม audit log ของ assign/priority และใบแบบ batch ที่ค้างจากสัปดาห์ 1
  invariant ของ seed ต้องยังผ่าน
- แปลเทสเดิมของ status flow แล้วอัปเดต PARITY.md
- /reopen และ job ปิดอัตโนมัติ ยังไม่ทำ (สัปดาห์ 5) แต่ /assign กับใบ resolved ต้องได้ 409 แล้ว

จะถือว่าเสร็จเมื่อ:
- `npm run lint && docker compose up -d && npm run migration:run && npm run seed && npm test && npm run test:e2e`
  ผ่านตั้งแต่ต้นจนจบ
- เทส concurrency ผ่าน:
  - รูมเมท 2 คนกด /confirm ใบเดียวกันพร้อมกัน → log resolved→closed แถวเดียว อีกคนได้ 409
  - Staff 2 คน /assign ใบ open พร้อมกันให้ช่างคนละคน → status log open→assigned แถวเดียว และ assigned_to ตรงกับ audit แถวสุดท้าย
  - ระงับช่างพร้อมกับ /assign ให้ช่างคนนั้น → ไม่มีทางที่ทั้งคู่สำเร็จ
  - ช่างกด resolve พร้อมกับ Staff reassign → ผลสุดท้ายสอดคล้องกับ log ไม่มีสถานะค้างครึ่งทาง
- contract test ของ actions ผ่านทุกคู่ผู้ใช้ × ใบใน fixture และ actions ใน list เท่ากับใน detail
- เทส auto_close_at: resolved → มีค่า / resolved + disputed → null / สถานะอื่น → null / ค่ามาจาก env ตัวเดียวกับ job
- mutation check ลองแล้วเทสต้องแดงทุกข้อ (ลองแล้วเปลี่ยนกลับ):
  - ลบ lock แถวใน transition()
  - ลบ TRANSITION_ONLY_VIA (Staff /assign ใบ resolved ต้อง 409)
  - เขียน status log ด้วย repository ที่ inject มาแทน manager (ESLint หรือเทสทรานแซกชันต้องจับได้)
  - ข้าม canSee ใน action (ใบห้องอื่นต้อง 404 ไม่ใช่ 403)
  - ให้ technician ไป closed ได้
  - ให้ admin /confirm ใบห้องพักได้
  - ไม่ล้าง disputed_at ตอนเข้า resolved
  - เอา pending_parts ออกจาก NOTE_REQUIRED
  - ยอมให้นัดเวลาที่ผ่านไปแล้ว
  - เพิ่ม action ที่ไม่ควรมีลงใน allowedActions
  - ส่งอีเมลแจ้ง resolved ก่อน commit (เทส rollback ต้องจับได้)

(กฎ "ถ้าเจอปัญหา" และรูปแบบสรุปจบช่วง ใช้ตาม CLAUDE.md หัวข้อ "วิธีทำงานใน repo นี้")
```

---

## สัปดาห์ 5 — reopen, ปิดอัตโนมัติ, รายงาน, QR

```
เริ่มสัปดาห์ 5 ตาม UI-PLAN.md หัวข้อ 8

ขอบเขต:
- POST /tickets/:id/reopen ตาม DESIGN (note บังคับ, side effects ตาม P2) ใบกลับไปหาช่างคนเดิม
- แจ้งเตือนตอนถูกส่งกลับ (DESIGN-PATCH P7.1) และตัวกรอง reopened + last_reopen_note (P12)
- GET /scan/:qrToken แบบมี open_ticket (+ reported_by_me, actions) และ can_report ตาม P11 (open_ticket ต้องผ่าน canSee)
- GET /assets?room_id=… พร้อม open_ticket ต่อชิ้น (P13)
- ตัวกรองคิว + GET /tickets/queue-counts (P14)
- job ปิดอัตโนมัติตาม P10 อ่านเวลาจาก env AUTO_CLOSE_AFTER_HOURS (ค่าเริ่มต้น 72)
  + POST /admin/jobs/auto-close/run (admin) ที่เรียก closeIfStillDue ตัวเดียวกับ cron
- reports ตาม DESIGN หัวข้อ 9: SLA (หยุดนับช่วง pending_parts, จบที่ resolved), เวลาค้างต่อขั้น,
  close_reason, งานของช่าง (resolved, SLA มัธยฐาน, reopen) จัดกลุ่มตามอาคาร/หมวด/ช่าง/เดือน
  แบ่งวันและเดือนตามเวลาไทย
- GET /assets/:id/qr (PNG) โดย QR ชี้ไปที่ /app/scan/:qrToken
  ถ้าต้องเพิ่ม library สร้าง QR ให้หยุดถามก่อน
- seed เดโม: มีใบ resolved ที่เกินกำหนดแล้วอย่างน้อย 2 ใบ, มีใบ reopen, ใบที่ Staff ปิดทั้งที่มีคนแย้ง
- แปลเทสเดิมของ reports, auto-close, QR แล้วอัปเดต PARITY.md

จะถือว่าเสร็จเมื่อ:
- คำสั่งชุดเดียวกับสัปดาห์ 4 ผ่านตั้งแต่ต้นจนจบ
- เทสของ job: ครบกำหนด → ปิด / reopen+resolve ใหม่ระหว่างรอบ → ไม่ปิด / ตั้ง disputed_at ระหว่างรอบ → ไม่ปิด /
  confirm พร้อมกับ job → log resolved→closed แถวเดียว / ใบหนึ่ง error → ใบอื่นยังถูกปิด
- เทสรายงาน: ใบที่ soft delete ไม่ถูกนับ / ใบที่แจ้งตอน 01:00 วันที่ 1 (เวลาไทย) อยู่ในเดือนใหม่ /
  ช่วง pending_parts ไม่ถูกนับใน SLA
- เส้นทาง dispute → reopen → resolve → ครบกำหนด → ถูกปิดอัตโนมัติได้
- mutation check (เทสต้องแดง): job ไม่เช็คเงื่อนไขซ้ำหลัง lock / ลืม deleted_at ในรายงาน /
  แบ่งเดือนด้วย UTC / นับ pending_parts เข้า SLA / ไม่ล้าง disputed_at ตอน reopen /
  /scan ส่ง open_ticket ของห้องอื่นออกมา / can_report คำนวณแยกจาก assertCanReport /
  แจ้งเตือนตอนถูกส่งกลับส่งก่อน commit / queue-counts นับต่างจาก query param ที่คู่กัน /
  /assets ส่ง open_ticket ของห้องอื่นออกมา

(กฎ "ถ้าเจอปัญหา" และรูปแบบสรุปจบช่วง ใช้ตาม CLAUDE.md หัวข้อ "วิธีทำงานใน repo นี้")
```

---

## UI-1 — โครง web/ + หน้านักศึกษา

```
เริ่มช่วง UI-1 ตาม UI-PLAN.md หัวข้อ 8

อ่าน UI-PLAN.md ทั้งไฟล์ และเปิด docs/ui/mockup.html กดเล่นแท็บนักศึกษาให้ครบทุกจอก่อนเริ่ม
ต้นแบบคือแบบที่ต้องทำให้ได้ ทั้ง layout, ข้อความ, ไอคอน, bottom sheet และ toast

ขอบเขต:
- scaffold web/ ตาม UI-PLAN หัวข้อ 7 (React + Vite + TS, base /app/, proxy ไป :3100)
  dependency ใช้ได้เฉพาะที่ระบุในหัวข้อ 7
- Nest เสิร์ฟ web/dist ที่ /app และส่ง index.html สำหรับ /app/* (path ของ API ห้ามเปลี่ยน)
- api/client.ts: แนบ Bearer, แปลง error body เป็น object ที่มี code, ได้ 401 → ล้าง session แล้วไป login
- ui/ ตาม UI-PLAN หัวข้อ 3: tokens.css และ icons.tsx คัดลอกจาก mockup (ห้ามคิดค่าใหม่, ห้ามเพิ่ม library ไอคอน)
  + component ที่ระบุไว้ (BottomSheet, Toast, TabBar ฯลฯ) และ ui/status.ts เป็นที่เดียวที่แปลงสถานะเป็นข้อความ สี และกลุ่ม
- หน้านักศึกษาตาม UI-PLAN หัวข้อ 5: login (รหัสช่องเดียว), หน้าแรกหลังสแกน, แจ้งซ่อม (ชิ้นที่มีใบเปิดเลือกไม่ได้),
  ส่งแจ้งซ่อมแล้ว, ส่งซ่อมแล้ว (3 กลุ่ม), รายละเอียดใบ + bottom sheet ยืนยัน/ยังไม่หาย/ยกเลิก + แถบล่าง 2 แท็บ
  ปุ่มบนหน้าแรกหลังสแกนมาจาก open_ticket และ can_report เท่านั้น
  ปุ่มทุกปุ่มบนหน้ารายละเอียดใบมาจาก ticket.actions เท่านั้น (UI-PLAN หัวข้อ 2 ข้อ 1)
- error ตามตาราง UI-PLAN หัวข้อ 6 ใช้ชื่อ code จริงจากโค้ด ถ้าชื่อไม่ตรงให้แก้ตารางใน UI-PLAN
- ESLint ของ web/: ห้ามเทียบ .status === และ .role === ใน web/src/pages/** (ยกเว้น ui/status.ts และการเลือกหน้าแรกใน routes.tsx)
- Playwright เส้นทาง UI-1 ตาม UI-PLAN หัวข้อ 9 รันกับ backend จริงที่ seed แล้ว
  login ใช้รหัสจาก MailService ตัวปลอม (ถ้าต้องเพิ่ม endpoint สำหรับเทสให้หยุดถามก่อน)

จะถือว่าเสร็จเมื่อ:
- `npm run lint && npm run web:lint && npm run web:typecheck && npm run web:build && npm run test:e2e && npm run web:e2e`
  ผ่านตั้งแต่ต้นจนจบ
- เปิด http://localhost:3100/app/ หลัง web:build แล้วใช้งานได้โดยไม่ต้องรัน Vite
- screenshot ทุกหน้าที่ 360px และ 1280px ทั้ง light/dark เก็บไว้ใน web/e2e/__screenshots__/ และไม่มีหน้าไหนล้นจอ
- mutation check (เทสต้องแดง):
  - ลบ 'confirm' ออกจาก actions ฝั่ง API → Playwright ที่หาปุ่มยืนยันต้องแดง
  - เขียน if (ticket.status === 'resolved') เพื่อแสดงปุ่มใน pages/ → web:lint ต้องแดง
  - แสดงข้อความ 404 ต่างกันระหว่าง "ไม่มีใบ" กับ "ไม่มีสิทธิ์" → เทสต้องแดง

ส่งรายการ screenshot มาพร้อมสรุป ผมจะเทียบกับ mockup เอง

(กฎ "ถ้าเจอปัญหา" และรูปแบบสรุปจบช่วง ใช้ตาม CLAUDE.md หัวข้อ "วิธีทำงานใน repo นี้")
```

---

## UI-2 — หน้าช่าง, คิวงาน Staff, รายงาน

```
เริ่มช่วง UI-2 ตาม UI-PLAN.md หัวข้อ 8

เปิด docs/ui/mockup.html กดเล่นแท็บช่าง, Staff และรายงานให้ครบก่อนเริ่ม

ขอบเขต:
- หน้าช่างตาม UI-PLAN หัวข้อ 5: งานของฉัน (ถูกส่งกลับ / นัดวันนี้ / รออะไหล่ / อื่น ๆ / รอผู้พักยืนยัน)
  และรายละเอียดงาน + bottom sheet ซ่อมเสร็จ / รออะไหล่ / นัดเวลา
- คิวงาน Staff: ตัวกรอง 6 ตัวพร้อมตัวเลขจาก queue-counts + ตาราง + แผงรายละเอียด (ปุ่มตาม actions)
  timeline จาก GET /tickets/:id/history ช่วงรออะไหล่ขีดฆ่าว่าไม่นับ SLA
- หน้ารายงาน: KPI 4 ตัว, เวลาค้างต่อขั้น, ใครเป็นคนปิดใบ, งานของช่างแต่ละคน
  กราฟทำด้วย HTML/CSS หรือ SVG เอง ห้ามเพิ่ม library กราฟ
- ถ้าต้องการ query param หรือ endpoint ที่ API ยังไม่มี (เช่น ตัวเลขในแถบด้านบนของคิว) ให้หยุดถามก่อน
- Playwright เส้นทาง UI-2 ตาม UI-PLAN หัวข้อ 9

จะถือว่าเสร็จเมื่อ:
- คำสั่งชุดเดียวกับ UI-1 ผ่านตั้งแต่ต้นจนจบ
- screenshot หน้าใหม่ทุกหน้าที่ 360px และ 1280px ทั้ง light/dark
- mutation check (เทสต้องแดง):
  - ช่างเห็นงานของช่างคนอื่นใน "งานของฉัน"
  - Staff เห็นปุ่มยืนยันบนใบห้องพักที่ resolved
  - ตัวเลข "รอมอบหมาย" ไม่ลดลงหลังมอบหมายใบจากคิว

(กฎ "ถ้าเจอปัญหา" และรูปแบบสรุปจบช่วง ใช้ตาม CLAUDE.md หัวข้อ "วิธีทำงานใน repo นี้")
```

---

## สัปดาห์ 6 — เก็บงานและเตรียมเดโม

```
เริ่มสัปดาห์ 6 ตาม UI-PLAN.md หัวข้อ 8

ขอบเขต:
- comments (is_internal) ตาม DESIGN: นักศึกษาไม่เห็นและเขียน internal ไม่ได้ ทั้งใน API และหน้าจอ
- mutation check รอบสุดท้าย: รันทุกข้อจากทุกสัปดาห์อีกรอบ สรุปเป็นตารางว่าข้อไหนแดงจริง
- Swagger: ทุก endpoint มี decorator ครบ มีตัวอย่าง request/response และ error code
- seed เดโมที่เล่าเรื่องได้ครบ: แจ้งซ้ำ, same-issue จนยกเป็นด่วนมาก, รออะไหล่, reopen,
  ใบส่วนกลางที่มีคนแย้ง, ใบที่ระบบปิดให้
- Playwright ครบเส้นทางเดโม 1 ไฟล์ที่รันตามลำดับเดียวกับที่จะนำเสนอ
- ร่างลำดับการเดโม (docs/demo.md): ขั้นตอน, บัญชีที่ใช้, สิ่งที่ต้องชี้ให้กรรมการดูในแต่ละขั้น
- PARITY.md ปิดครบทุกข้อ

จะถือว่าเสร็จเมื่อ:
- คำสั่งชุดเต็มของ UI-1 ผ่านตั้งแต่ต้นจนจบบนเครื่องที่ clone repo ใหม่ (ลบ node_modules และ volume ของ docker ก่อนลอง)
- ไล่ตาม docs/demo.md ได้จนจบโดยไม่ต้องแก้ข้อมูลด้วยมือ

(กฎ "ถ้าเจอปัญหา" และรูปแบบสรุปจบช่วง ใช้ตาม CLAUDE.md หัวข้อ "วิธีทำงานใน repo นี้")
```
