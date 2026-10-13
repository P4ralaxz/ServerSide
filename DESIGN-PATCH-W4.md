# DESIGN patch ก่อนสัปดาห์ 4 (รวมส่วนที่หน้าจอต้องใช้ตามต้นแบบ docs/ui/mockup.html)

| รหัส | เรื่อง | ทำในสัปดาห์ |
|---|---|---|
| P1–P7, P9 | workflow, side effects, ลำดับการตรวจ, assign/schedule/status, แจ้งเตือน resolved, history | 4 |
| P8, P15 | `actions` (detail + list), field ของใบที่หน้าจอใช้ | 4 |
| P16 | เช็คสัญญา description/title ของ `POST /tickets` | 4 (แค่เช็คแล้วรายงาน) |
| P7.1, P10–P14 | reopen แจ้งเตือน, auto-close, scan, ตัวกรองคิว + ตัวเลข, assets พร้อมใบเปิด | 5 |

> ส่วนที่ขาดไปจาก DESIGN ฉบับใน repo พร้อมรวมคำตอบที่ตัดสินแล้วหลังจากนั้น
> **ห้ามเขียนทับ DESIGN ทั้งไฟล์** ให้แทรกหรือแก้ทีละหัวข้อในจุดที่ตรงกัน แล้วแสดง diff
> ถ้าหัวข้อไหนในนี้ขัดกับของที่ DESIGN ปัจจุบันเขียนไว้ หรือขัดกับโค้ดที่ทำไปแล้ว ให้หยุดถามก่อนรวม

---

## P1. ตารางกฎสถานะ (แทนตาราง TRANSITIONS เดิม)

```ts
export const OPEN_STATUSES = ['open','assigned','in_progress','pending_parts','resolved'] as const;
// cancelled, closed, rejected = สถานะสุดท้าย

export const TRANSITIONS = {
  open:          { assigned: ['staff'], rejected: ['staff'], cancelled: ['student'] },
  assigned:      { in_progress: ['technician'], rejected: ['staff'] },
  in_progress:   { pending_parts: ['technician'], resolved: ['technician'], assigned: ['staff'] },
  pending_parts: { in_progress: ['technician'], assigned: ['staff'] },
  resolved:      { closed: ['student','staff','system'], assigned: ['student','staff'] },
  closed: {}, rejected: {}, cancelled: {},
};
```

- `admin` ได้ทุกสิทธิ์ของ `staff` โดยขยาย role ใน RolesGuard / `actorOf()` **ที่เดียว** (admin ⊇ staff)
  ไม่ต้องใส่ `'admin'` ทีละ endpoint
- ข้อยกเว้นที่ยังใช้กับ admin ด้วย: `/confirm` และ `/reopen` ใบ `scope = room` ต้องเป็น student ที่พักห้องนั้นเท่านั้น
- `cancelled`: ผู้แจ้งเท่านั้น (`reporter_id = user.id`) และเฉพาะตอน `open` ผ่าน `POST /tickets/:id/cancel`

### เส้นทางที่ผูกกับ endpoint เดียว

```ts
// กัน Staff กด /assign กับใบ resolved ซึ่งจะกลายเป็นการ reopen ที่ข้ามสิทธิ์ของ /reopen และไม่ต้องใส่ note
export const TRANSITION_ONLY_VIA = {
  'resolved->assigned': '/reopen',
  'resolved->closed':   '/confirm',   // หรือ 'auto-close' จาก job
  'open->cancelled':    '/cancel',
};
```

### สถานะที่ต้องมี note

`pending_parts`, `rejected`, และ reopen (`resolved → assigned`) · `resolved` ไม่บังคับ แต่ช่องอยู่ในฟอร์ม

---

## P2. ฟิลด์ที่ต้องตั้ง / ล้างในแต่ละการเปลี่ยนสถานะ (`applySideEffects`)

ฟิลด์ที่ผูกกับรอบ resolve ปัจจุบันต้องล้างเมื่อรอบนั้นจบ ไม่งั้นค่าจากรอบก่อนจะค้างมาทำให้รอบถัดไปผิด

| การเปลี่ยน | ตั้ง | ล้าง |
|---|---|---|
| `open → assigned` | `assigned_to` | – |
| `in_progress / pending_parts → assigned` (reassign) | `assigned_to` ใหม่ | `scheduled_at` |
| `* → resolved` | `resolved_at = now()` | `disputed_at` (เริ่มรอบยืนยันใหม่) |
| `resolved → assigned` (reopen) | `reopen_count += 1` | `resolved_at`, `disputed_at`, `confirmed_by` |
| `resolved → closed` (ผู้พัก / Staff) | `closed_at`, `confirmed_by = user.id`, `close_reason` | **ไม่ล้าง `disputed_at`** เก็บไว้ให้รายงานรู้ว่า Staff ปิดทั้งที่มีคนแย้ง |
| `resolved → closed` (ระบบ) | `closed_at`, `close_reason = auto_closed`, `confirmed_by = NULL` | – |
| `open → cancelled` | `closed_at` | – |
| `open / assigned → rejected` | `closed_at` | – |

ไม่ใช่การเปลี่ยนสถานะ → ลง `ticket_audit_logs` เท่านั้น:
มอบหมายซ้ำตอน `assigned` (`reassign`), `schedule`, `priority`, `auto_escalate`, `same_issue`, `dispute`

เทสต่อแถวในตารางนี้ และเส้นทาง dispute → reopen → resolve ใหม่ ต้องได้ `disputed_at = NULL`

---

## P3. ลำดับการตรวจในทุก action (`transition()`)

```
lock แถว ticket (pessimistic_write, ไม่ใส่ relations)
→ ไม่พบ / deleted                    → 404
→ canSee(user, ticket) เป็น false     → 404   (ชั้น 2a: มองไม่เห็น = ไม่มีใบนี้)
→ assertCan(action, user, ticket)     → 403   (ชั้น 2b: มองเห็นแต่ทำไม่ได้)
→ TRANSITIONS / TRANSITION_ONLY_VIA   → 409
→ note ที่บังคับ                       → 400
→ applySideEffects → save → insert status log  (ทรานแซกชันเดียวกัน)
```

`actor = 'system'` ใช้ได้เฉพาะจาก job ปิดอัตโนมัติ (สัปดาห์ 5) controller ส่งค่านี้ไม่ได้

---

## P4. `/assign`

- ช่างปลายทาง: อ่านแถว user ด้วย `FOR SHARE` แล้วเช็ค `role = technician`, `is_active = true`, `deleted_at IS NULL` ไม่ผ่าน → 400
  (lock นี้ชนกับ `FOR UPDATE` ตอนระงับช่างในหัวข้อ 4.4 ทำให้สองคำขอผ่านพร้อมกันไม่ได้)
- `open → assigned`: status log + audit `assign`
- `assigned` อยู่แล้ว มอบหมายคนใหม่: ไม่เขียน status log (CHECK `ck_real_transition` จะ error) เขียน audit `reassign` `{from, to}`
- `in_progress / pending_parts → assigned`: status log + audit `reassign` + ล้าง `scheduled_at`
- `resolved` → 409 (ต้องไปทาง `/reopen`)

## P5. `/schedule`

- ใครทำได้: ช่างเจ้าของงาน, staff (และ admin)
- สถานะที่นัดได้: `assigned`, `in_progress`, `pending_parts` อื่น ๆ → 409
- เวลาที่ผ่านไปแล้ว → 400
- ไม่ใช่การเปลี่ยนสถานะ เขียน audit `schedule` `{from, to}`

## P6. `/status` (ช่าง)

| จาก | ไป | action ใน `actions` | note |
|---|---|---|---|
| assigned | in_progress | `start` | – |
| in_progress | pending_parts | `pending_parts` | บังคับ (อะไหล่ที่รอ) |
| pending_parts | in_progress | `resume` | – |
| in_progress | resolved | `resolve` | ไม่บังคับ |

ปลายทาง `assigned`, `closed`, `rejected`, `cancelled` ผ่าน `/status` ไม่ได้ → 409

## P7. แจ้งเตือนตอน resolved

- หลัง commit ทรานแซกชันที่เปลี่ยนเป็น `resolved` แล้วเท่านั้น (ห้ามส่งใน transaction)
- ใบห้องพัก → ส่งหานักศึกษาที่ `room_id` ตรงกับใบ และ `is_active = true`
- ใบส่วนกลาง → ส่งหา staff ทุกคนที่ใช้งานอยู่
- เนื้อหา: เลขใบ, ครุภัณฑ์, ข้อความของช่าง, เวลาที่ระบบจะปิดให้, ลิงก์ `/app/tickets/:id`
- ส่งไม่สำเร็จ → log แล้วจบ ไม่ rollback ไม่ retry
- e2e: ใช้ MailService ตัวปลอม เช็คว่าได้ผู้รับถูกคน และไม่ส่งเมื่อทรานแซกชัน rollback

## P7.1 แจ้งเตือนตอนถูกส่งกลับ (reopen) — สัปดาห์ 5 พร้อม `/reopen`

ใบที่ถูกส่งกลับไปหา **ช่างคนเดิม** (`resolved → assigned`, `assigned_to` ไม่เปลี่ยน) ตามที่ DESIGN กำหนดไว้ ไม่ผ่าน Staff ก่อน
แต่ต้องแจ้งให้รู้ตัว:
- ส่งอีเมลหาช่างเจ้าของงาน และ staff ทุกคนที่ใช้งานอยู่
- เนื้อหา: เลขใบ, ครุภัณฑ์, ห้อง, เหตุผลที่ผู้พักเขียน (note ของ reopen), ส่งกลับครั้งที่เท่าไร (`reopen_count`), ลิงก์ไปที่ใบ
- เงื่อนไขการส่งเหมือน P7 ทุกข้อ (หลัง commit, ไม่ rollback, ไม่ retry)

## P8. ฟิลด์ `actions`

`actions: TicketAction[]` = สิ่งที่ผู้ใช้คนนี้ทำกับใบนี้ได้ **ตอนนี้** ส่งทั้งใน `GET /tickets/:id` **และแต่ละรายการของ `GET /tickets`**
(หน้า "ส่งซ่อมแล้ว" ใช้แยกกลุ่ม "รอคุณยืนยัน" จากรายการโดยไม่ต้องเปิดทีละใบ)

```ts
type TicketAction =
  | 'cancel' | 'same_issue' | 'comment'
  | 'assign' | 'reject' | 'priority' | 'schedule'
  | 'start' | 'pending_parts' | 'resume' | 'resolve'   // ช่าง ผ่าน /status
  | 'confirm' | 'reopen';
```

- คำนวณใน `TicketPolicy.allowedActions(user, ticket)` โดยเรียกฟังก์ชันเดียวกับที่ endpoint ใช้เช็ค
  (`canSee` → `assertCan` → `TRANSITIONS` → `TRANSITION_ONLY_VIA`) ห้ามเขียนเงื่อนไขชุดใหม่
- ใน `GET /tickets` คำนวณจากข้อมูลที่โหลดมาแล้ว ห้าม query เพิ่มต่อแถว (N+1)
- **contract test**: วนทุกคู่ผู้ใช้ × ใบใน fixture ใน transaction ที่ rollback ทุกครั้ง
  - action ที่อยู่ใน `actions` → เรียก endpoint แล้วต้องไม่ได้ 403/409 (400 จาก note ว่างยอมรับได้)
  - action ที่ไม่อยู่ใน `actions` → ต้องได้ 403 หรือ 409
  - `actions` ใน list ต้องเท่ากับใน detail ของใบเดียวกัน
- mutation: เพิ่ม action ที่ไม่ควรมีลงใน `allowedActions` เทสต้องแดง

## P9. `GET /tickets/:id/history`

- ใช้ `canSee` เหมือน `GET /tickets/:id` (มองไม่เห็น → 404)
- รวม `ticket_status_logs` และ `ticket_audit_logs` เรียงตามเวลา แต่ละแถวบอกชนิด (`status` / `audit`)
- คืน `duration` ของแต่ละขั้นสถานะ (เวลาถึงการเปลี่ยนสถานะถัดไป หรือถึงตอนนี้ถ้ายังอยู่ขั้นนั้น)
- `GET /tickets/:id` เลิกส่ง `status_logs` เมื่อ endpoint นี้พร้อม (หน้าจอจะเรียก history แยก)

## P11. `GET /scan/:qrToken` — หน้าแรกหลังสแกน (สัปดาห์ 5)

หน้าแรกหลังสแกนต้องให้ผู้ใช้ **ดูสถานะของที่แจ้งไปแล้ว** ได้ ไม่ใช่พาไปฟอร์มแจ้งซ่อมทันที
API จึงต้องบอกว่าชิ้นนี้มีใบเปิดอยู่ไหม และผู้ใช้คนนี้แจ้งได้ไหม

```jsonc
{
  "asset": { "id", "asset_code", "name", "category", "building", "room" /* null = ส่วนกลาง */ },
  "open_ticket": { "id", "ticket_no", "status", "updated_at", "reported_by_me", "actions" } | null,
  "can_report": true | false
}
```

- `open_ticket`: ใบใน `OPEN_STATUSES` ของ asset นี้ **และ** `canSee(user, ticket)` เป็นจริง ถ้ามองไม่เห็นให้เป็น `null`
  (สแกน QR ของห้องอื่นต้องไม่รู้ว่าห้องนั้นแจ้งอะไรไว้ กติกาเดียวกับลำดับเช็ค ownership ก่อน duplicate)
- `reported_by_me`: มีแถวใน `ticket_reporters` ของผู้ใช้คนนี้กับใบนี้ (หน้าจอใช้ซ่อนปุ่ม "เจอปัญหาเดียวกัน")
- `actions`: ชุดเดียวกับ P8 (หน้าสแกนใช้เลือกข้อความปุ่ม "ดูและยืนยันผลซ่อม")
- `can_report`: ผลของ `assertCanReport(user, asset)` ตัวเดียวกับที่ `POST /tickets` ใช้ ห้ามเขียนเงื่อนไขใหม่
  และเป็น `false` ถ้ามี `open_ticket` อยู่แล้ว (ให้กด same-issue แทน)
- `qrToken` ไม่พบหรือ asset ถูก soft delete → 404
- ต้อง login (401 → หน้าเว็บพาไป login แล้วกลับมาหน้าเดิม)
- เทส: สแกน asset ห้องตัวเองที่มีใบเปิด → เห็นใบ · สแกน asset ห้องอื่นที่มีใบเปิด → `open_ticket = null`, `can_report = false` ·
  สแกนส่วนกลางที่มีใบเปิด → เห็นใบ · ช่าง/Staff สแกน → `can_report` ตาม role

## P12. ตัวกรอง "ถูกส่งกลับ" ใน `GET /tickets` (สัปดาห์ 5)

- query param `reopened=true` → ใบที่ `reopen_count > 0` และยังอยู่ใน `OPEN_STATUSES`
- ใช้ร่วมกับ `visibilityFilter` เดิม (ช่างเห็นเฉพาะของตัวเอง)
- `reopen_count` และ `last_reopen_note` อยู่ในรายการแล้วตาม P15

## P13. ครุภัณฑ์ในห้องพร้อมสถานะใบที่เปิดอยู่ (สัปดาห์ 5)

หน้าแจ้งซ่อมแสดงชิ้นที่มีใบเปิดอยู่เป็นสถานะแทนช่องให้เลือก (ลดการแจ้งซ้ำตั้งแต่ก่อนกดส่ง)

- `GET /assets?room_id=…` แต่ละชิ้นมี `open_ticket: { id, ticket_no, status } | null`
- `open_ticket` ผ่าน `canSee` เหมือน P11 · หาใบเปิดด้วย query เดียว (join กับ `OPEN_STATUSES`) ห้ามทำ N+1
- นักศึกษาขอ `room_id` ของห้องอื่น → 403 (ยกเว้นครุภัณฑ์ส่วนกลาง)
- ด่านจริงยังเป็น ON CONFLICT ตอน `POST /tickets` (ถ้ามีคนแจ้งตัดหน้า จะได้ `skipped[]` ตามเดิม)

## P14. ตัวกรองคิวและตัวเลขของ Staff (สัปดาห์ 5)

`GET /tickets` รับ query param (ใช้ร่วมกับ `visibilityFilter` และ pagination เดิม):

| param | ความหมาย |
|---|---|
| `status=open` | ใบที่รอมอบหมาย |
| `priority=urgent` | ด่วนมาก (เฉพาะ `OPEN_STATUSES`) |
| `disputed=true` | `status = resolved` และ `disputed_at IS NOT NULL` |
| `reopened=true` | P12 |
| `scope=common_area&status=resolved` | ส่วนกลางรอยืนยัน |

`GET /tickets/queue-counts` (staff, admin) → ตัวเลขทุกตัวกรองในคำขอเดียว

```jsonc
{ "open_total": 23, "unassigned": 7, "urgent": 3, "disputed": 2, "reopened": 1, "common_pending_confirm": 4 }
```

- นับด้วย `COUNT(*) FILTER (WHERE …)` query เดียว เงื่อนไขของแต่ละตัวต้องมาจากฟังก์ชันเดียวกับ query param ข้างบน
- เทส: ตัวเลขแต่ละตัวเท่ากับจำนวนรายการเมื่อกรองด้วย param ที่คู่กัน

## P15. field ของใบที่หน้าจอต้องใช้ (สัปดาห์ 4)

`GET /tickets/:id` และรายการใน `GET /tickets` ส่งเพิ่ม:

| field | ที่มา |
|---|---|
| `assignee: { id, name } \| null` | join users |
| `report_count`, `reopen_count` | คอลัมน์เดิม |
| `last_reopen_note` | note ของ status log `resolved → assigned` ล่าสุด (P12) |
| `scheduled_at`, `permission_to_enter` | คอลัมน์เดิม |
| `auto_close_at` | `resolved_at + AUTO_CLOSE_AFTER_HOURS` เมื่อ `status = resolved` และ `disputed_at IS NULL` · อื่น ๆ = `null` |

- `auto_close_at` คำนวณจาก env ตัวเดียวกับ job ปิดอัตโนมัติ ห้ามเขียนเลข 72 ซ้ำ
- `GET /tickets` ห้าม query เพิ่มต่อแถว

## P16. คำอธิบายอาการตอนแจ้งซ่อม

หน้าจอบังคับกรอก "อาการ" ทุกรายการ ให้เช็คว่า `POST /tickets` ตอนนี้บังคับ `description` หรือไม่ และ `title` ได้มาจากไหน
- ถ้า API บังคับ `title`: หน้าจอส่งชื่อครุภัณฑ์เป็น `title` และส่งอาการเป็น `description`
- ถ้า API ไม่บังคับ `description`: **หยุดถามก่อน** ว่าจะบังคับที่ API ด้วยหรือไม่ (เป็นการเปลี่ยนสัญญาของ API)

## P10. job ปิดอัตโนมัติ (สัปดาห์ 5 ใส่ไว้ให้เห็นภาพรวม)

1. หารายชื่อใบที่น่าจะครบกำหนด (`status = resolved`, `disputed_at IS NULL`, `resolved_at < now() - AUTO_CLOSE_AFTER_HOURS`) โดยไม่ lock
2. ทีละใบในทรานแซกชันของใบนั้น: lock แล้ว **เช็คเงื่อนไขในข้อ 1 ซ้ำทั้งหมด** ไม่ผ่าน → ข้าม ผ่าน → `transition(m, 'system', id, 'closed', {via:'auto-close'})`
3. error ของใบเดียว → log แล้วไปใบถัดไป

เหตุผลที่ต้องเช็คซ้ำ: ระหว่างข้อ 1 กับข้อ 2 ใบอาจถูก reopen แล้ว resolve ใหม่ หรือมีคนแย้งจน `disputed_at` ถูกตั้ง
