# PARITY.md — เทสเดิม 252 เคส ที่ยังไม่แปลมา NestJS

ที่มา: `P4ralaxz/ServerSide-0` commit `4f1c980` โฟลเดอร์ `tests/`
นับจำนวน: `def test_*` = 229 ฟังก์ชัน × ขยาย `@pytest.mark.parametrize` = **252 เคสที่ pytest เก็บได้** (ตรงกับ DESIGN หัวข้อ 10)

| ไฟล์เดิม | `def` | ขยาย parametrize | เคสที่เก็บได้ | โมดูลใหม่ |
|---|---|---|---|---|
| `test_smoke.py` | 10 | – | 10 | schema contract + status machine |
| `test_auth.py` | 29 | +4 | **33** | auth |
| `test_rooms_assets_users.py` | 31 | +1 | **32** | users / rooms / buildings / assets |
| `test_tickets.py` | 55 | +3 | **58** | tickets (สร้าง, policy, แจ้งซ้ำ, โควตา, same-issue, visibility) |
| `test_ticket_status.py` | 53 | +3 | **56** | workflow |
| `test_auto_close.py` | 14 | +4 | **18** | auto-close job |
| `test_reports.py` | 23 | +7 | **30** | reports |
| `test_qr_scan.py` | 14 | +1 | **15** | QR / scan |
| **รวม** | **229** | **+23** | **252** | |

## สัญลักษณ์สถานะการแปล

| ป้าย | ความหมาย |
|---|---|
| `P` | **@parity** — แปลตรง ๆ กฎไม่เปลี่ยน |
| `P*` | **@parity** แต่ต้องปรับชื่อ/ค่า (`new`→`open`, `medium`→`normal`, `assignee_id`→`assigned_to`, `changed_at`→`created_at`) |
| `S` | **@superseded** — DESIGN เปลี่ยนกฎ ต้องเขียนเทสใหม่คนละข้อ + บันทึกเหตุผล |
| `X` | **ตกไป** — ฟีเจอร์/คอลัมน์ที่ DESIGN ไม่มี ไม่มีที่ลง |
| `B` | **blocked** — รอคำตอบ DESIGN หัวข้อ 12 หรือคำถามในรายงาน |

ยังไม่แปลเลยแม้ข้อเดียว — ทุกช่อง "แปลแล้ว" ว่างทั้งหมด

---

## 1. auth (33 เคส) → `test/e2e/auth.e2e-spec.ts` · สัปดาห์ 2

### request-code (10)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 1 | `test_request_code_returns_202_and_sends_code` | P | |
| 2 | `test_request_code_same_response_for_known_and_unknown_email` | P | ข้อความเดียวกันเสมอ |
| 3–5 | `test_request_code_rejects_non_university_email` ×3 (`gmail.com`, `student.kmitl.ac.th`, ไม่ใช่อีเมล) | P | 400 |
| 6 | `test_code_is_stored_hashed_not_plain` | P* | เดิม HMAC(JWT_SECRET, `email:code`) — ใหม่ให้มี secret แยก |
| 7 | `test_email_is_normalized_to_lowercase` | P* | เดิม normalize ในโค้ด · ใหม่ใช้ `citext` → เทสเปลี่ยนเป็น "สองเคสอักษรได้บัญชีเดียว" |
| 8 | `test_request_code_rate_limited_per_email` | P | 5/ชม. |
| 9 | `test_request_code_rate_limited_per_ip` | **B** | เดิม 30/ชม./IP · DESIGN 5/ชม./IP → ดูคำถาม 2.6 และ `login_codes.ip_address` ที่ DDL ใหม่ไม่มี |
| 10 | `test_rate_limit_window_expires` | P | |

### verify-code (9)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 11 | `test_first_login_auto_provisions_student` | P* | เดิมตัด `student_id` จากอีเมล → DESIGN ไม่มีคอลัมน์นี้ |
| 12 | `test_login_keeps_role_assigned_by_admin` | P | |
| 13 | `test_wrong_code_counts_attempts_then_locks` | P | เดิมล็อกแล้วตอบ **429** |
| 14 | `test_expired_code_rejected` | P | |
| 15 | `test_code_is_single_use` | P | |
| 16 | `test_new_code_replaces_old_one` | P | |
| 17 | `test_verify_without_request_rejected` | P | |
| 18 | `test_verify_bad_code_format_is_400` | P | |
| 19 | `test_inactive_user_cannot_login` | **B** | เดิม **403** ที่ verify · DESIGN พูดถึง 401 แค่ที่ guard → ต้องเลือก |

### JWT guard (6)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 20 | `test_me_requires_token` | P | 401 |
| 21–23 | `test_me_rejects_bad_token` ×3 | P | |
| 24 | `test_me_rejects_expired_token` | P* | เดิมอายุ 1 วัน · DESIGN 8 ชม. |
| 25 | `test_me_rejects_token_signed_with_other_secret` | P | |
| 26 | `test_suspended_after_login_blocked_immediately` | P* | เดิม 403 · DESIGN guard ตอบ **401** → ปรับค่าคาด |

### RolesGuard (4)

| # | เทสเดิม | ป้าย |
|---|---|---|
| 27 | `test_role_guard_blocks_student_with_403` | P |
| 28 | `test_role_guard_allows_staff` | P |
| 29 | `test_role_change_takes_effect_without_new_token` | P |
| 30 | `test_role_guard_without_token_is_401` | P |

### DB / dev mode (3)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 31 | `test_db_rejects_non_university_email` | P | `ck_users_email_domain` → ผ่าน `DbErrorFilter` 23514 → 400 |
| 32 | `test_dev_mode_prints_code` | S | DESIGN ใช้ Mailpit ไม่ใช่ print → เทสใหม่: อ่านเมลจาก Mailpit API |
| 33 | `test_production_mode_never_prints_code` | S | เหมือนข้อ 32 |

---

## 2. users / rooms / buildings / assets (32 เคส) → สัปดาห์ 2

### rooms (12)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 34 | `test_anyone_logged_in_can_read_rooms` | P | |
| 35 | `test_rooms_require_login` | P | |
| 36–37 | `test_only_managers_create_rooms` ×2 (student, tech) | P | |
| 38 | `test_staff_creates_room` | P* | เดิมส่ง `building` เป็น string · ใหม่ส่ง `building_id` |
| 39 | `test_duplicate_room_is_409` | P* | `uq_rooms_no(building_id, room_no)` |
| 40 | `test_room_validation` | P | floor > 0 |
| 41 | `test_put_replaces_whole_room_patch_changes_one_field` | P | |
| 42 | `test_moving_room_building_moves_its_assets` | **X** | เดิม `building` เป็น string ซ้ำใน rooms/assets/tickets · ใหม่เป็น FK → ไม่มีอะไรต้อง "ย้ายตาม" → เปลี่ยนเป็นเทสว่า asset อ่าน building ผ่าน join ได้ถูก |
| 43 | `test_delete_room_in_use_is_409` | **X** | พึ่ง `rooms.capacity` / คนพักในห้อง — DESIGN ไม่มี `capacity` (ดูคำถาม 2.7) |
| 44 | `test_delete_room_with_assets_is_409` | P | |
| 45 | `test_delete_empty_room_admin_only` | P | |

### assets (9)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 46 | `test_create_common_area_asset_needs_building` | P* | ใหม่ `building_id` NOT NULL อยู่แล้ว |
| 47 | `test_in_room_asset_takes_building_from_room` | P | |
| 48 | `test_asset_unknown_room_is_400` | P | 23503 → 400 |
| 49 | `test_duplicate_asset_code_is_409` | P | |
| 50 | `test_student_cannot_write_assets` | P | |
| 51 | `test_patch_moves_asset_to_common_area_keeping_building` | P | |
| 52 | `test_patch_rejects_null_for_required_field` | P | |
| 53 | `test_soft_delete_asset` | P | + ใหม่: ลบ asset ที่มีใบเปิด → 409 (DESIGN หัวข้อ 7) |
| 54 | `test_asset_filters_and_qr_lookup` | **B** | พึ่ง `GET /assets/by-code` ที่ DESIGN หัวข้อ 7 ไม่มี (ดูคำถาม 2.3) |

### users (11)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 55 | `test_admin_precreates_technician` | P | |
| 56 | `test_staff_cannot_create_users` | P | |
| 57 | `test_create_user_duplicate_or_bad_email` | P | 409 / 400 |
| 58 | `test_student_cannot_list_users` | P | |
| 59 | `test_staff_assigns_room_then_student_can_report` | P | ผูกห้องแล้วแจ้งห้องได้ |
| 60 | `test_staff_cannot_change_role_or_suspend` | P | 403 |
| 61 | `test_staff_cannot_promote_self` | P | |
| 62 | `test_admin_changes_role_and_suspends` | P | |
| 63 | `test_admin_cannot_lock_self_out` | P | 400 |
| 64 | `test_full_room_is_409` | **X** | พึ่ง `rooms.capacity` — ดูคำถาม 2.7 |
| 65 | `test_list_users_filters` | P | |
| — | `DELETE /users/:id` → 204 | **ใหม่** | DESIGN หัวข้อ 7 มี แต่เทสเดิมไม่มี |

---

## 3. tickets — สร้าง / policy / แจ้งซ้ำ / โควตา / same-issue / visibility (58 เคส) → สัปดาห์ 3

### สร้างแบบ batch (9)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 66 | `test_batch_creates_separate_tickets_sharing_batch_id` | P | |
| 67 | `test_every_ticket_gets_initial_status_log` | P* | log แรก `NULL → open` |
| 68 | `test_single_item_has_no_batch_id` | S | DESIGN `batch_id uuid NOT NULL` → ใบเดี่ยวก็มี batch_id ของตัวเอง |
| 69 | `test_ticket_no_continues_from_existing` | S | เดิมนับจาก `MAX(ticket_no)` · DESIGN ใช้ `ticket_counters` upsert → เทสใหม่: เลขไม่ซ้ำแม้ 2 batch พร้อมกัน |
| 70 | `test_asset_fills_in_room_and_building` | P* | ใหม่ไม่มี `tickets.building` → เช็คแค่ `room_id`/`scope` |
| 71 | `test_permission_to_enter_is_saved` | **X** | DESIGN ไม่มี `permission_to_enter` (ดูคำถาม 2.2) |
| 72 | `test_too_many_items_is_400` | P | > 10 |
| 73 | `test_empty_items_is_400` | P | |
| 74 | `test_same_asset_twice_in_one_batch_is_400` | P | |

### สิทธิ์ตอนสร้าง — 3 ชั้น (16)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 75 | `test_requires_login` | P | 401 |
| 76 | `test_layer1_technician_cannot_report` | P | 403 ชั้น 1 |
| 77 | `test_layer2_cannot_report_other_room` | P | **เทสหลักของกฎข้อ 3** |
| 78 | `test_layer2_student_without_room_cannot_report_room` | P | `room_id = NULL` |
| 79 | `test_layer2_staff_also_locked_out_of_rooms` | P | Staff แจ้งแทนห้องไม่ได้ |
| 80 | `test_roommate_can_report_shared_room` | P | |
| 81 | `test_common_area_open_across_buildings` | P | **ห้ามเพิ่มเงื่อนไขอาคารเดียวกัน** |
| 82 | `test_common_area_without_asset_needs_known_building` | **B** | ใบไม่มี asset — DESIGN `asset_id NOT NULL` (ดูคำถาม 2.1) |
| 83 | `test_bad_item_fails_whole_batch` | P | |
| 84 | `test_cannot_disguise_room_asset_as_common_area` | P | **ช่องโหว่หลบเช็คห้อง** |
| 85 | `test_room_scope_with_common_asset_is_400` | P | |
| 86 | `test_room_id_must_match_asset` | P | |
| 87–88 | `test_location_required` ×2 (room, common) | **B** | ใบไม่มี asset — ดูคำถาม 2.1 |
| 89 | `test_retired_asset_is_400` | **X** | DESIGN ไม่มี `asset_status` (ดูคำถาม 2.8) |
| 90 | `test_deleted_asset_is_404` | P | |

### กันแจ้งซ้ำ (10)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 91 | `test_duplicate_single_item_is_409_with_ticket_no` | P | |
| 92 | `test_batch_with_one_duplicate_creates_the_rest` | P | 201 + `skipped[]` |
| 93 | `test_all_duplicates_in_batch_is_409` | P | |
| 94–95 | `test_resolved_and_pending_parts_still_block` ×2 | P | `resolved` ยังนับว่าเปิด |
| 96–97 | `test_closed_or_rejected_does_not_block` ×2 | P | **มี contract test คู่กัน** |
| 98 | `test_items_without_asset_are_never_duplicates` | **B** | ดูคำถาม 2.1 |
| 99 | `test_db_blocks_two_open_tickets_on_same_asset` | P | เขียนตรงที่ DB |
| 100 | `test_db_allows_new_ticket_after_close` | P | |

### โควตา (5)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 101 | `test_student_daily_limit` | **B** | เดิม 5 ใบ/24 ชม. แบบ rolling · DESIGN "ใบเปิดเกิน N" (หัวข้อ 12.3) |
| 102 | `test_batch_exceeding_quota_is_rejected_whole` | **B** | เหมือนกัน |
| 103 | `test_skipped_items_do_not_use_quota` | **B** | เหมือนกัน |
| 104 | `test_staff_has_no_daily_limit` | **B** | เดิมโควตาเฉพาะ student |
| 105 | `test_quota_window_is_rolling_24h` | **B** | ถ้าเปลี่ยนเป็น "ใบเปิด" เทสนี้หมดความหมาย |

> ทั้ง 5 เคสใช้ใบแบบ **ไม่มี asset** (`room_item(room=...)` ซ้ำ 5 ใบ) เพราะใบที่มี asset ชิ้นเดียวกันซ้ำกันไม่ได้
> ถ้า `asset_id NOT NULL` ต้องเขียนใหม่โดยเตรียม asset 5 ชิ้น — ผูกกับคำถาม 2.1

### same-issue (8)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 106 | `test_same_issue_increments_report_count` | P | |
| 107 | `test_same_issue_by_reporter_is_409` | P* | ใหม่ได้ผลเดียวกันผ่าน `ticket_reporters` ON CONFLICT |
| 108 | `test_same_issue_on_closed_ticket_is_409` | P | |
| 109 | `test_same_issue_on_other_room_is_403` | P | ชั้น 2 ก่อนชั้น 3 |
| 110 | `test_same_issue_missing_ticket_is_404` | P | |
| 111 | `test_technician_cannot_press_same_issue` | P | |
| 112 | `test_report_count_over_threshold_escalates_to_urgent` | P* | > 10 → urgent + audit `auto_escalate` |
| 113 | `test_escalation_never_extends_sla` | **X** | DESIGN ไม่มี `sla_due_at` (ดูคำถาม 2.4) |
| — | กดซ้ำคนเดิม → 409 `already_reported` | **ใหม่** | `ticket_reporters` เป็นของใหม่ทั้งหมด |

### visibility (10)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 114 | `test_student_cannot_view_other_room_ticket` | **B** | เดิม **403** · DESIGN **404** (หัวข้อ 12.4) |
| 115 | `test_everyone_sees_common_area_tickets` | P | |
| 116 | `test_technician_sees_only_assigned` | **B** | เดิม 403 ตอน GET · DESIGN 404 |
| 117 | `test_staff_sees_everything` | P | |
| 118 | `test_list_hides_other_rooms_from_student` | P | |
| 119 | `test_list_filters` | **B** | DESIGN หัวข้อ 7 ไม่ระบุ query param (ดูคำถาม 2.9) |
| 120 | `test_detail_includes_status_logs` | P* | `to_status = 'open'` |
| 121 | `test_soft_deleted_ticket_is_404` | P | |
| 122 | `test_timestamps_are_utc_aware` | P* | ตัด `sla_due_at` ออกจากลิสต์ฟิลด์ |
| 123 | `test_is_overdue_on_sqlite` | **X** | เป็นบั๊กของ SQLite + `sla_due_at` ทั้งคู่ไม่มีแล้ว |

> เดิม student เห็น "ใบที่ตัวเองแจ้ง" ด้วย (`reporter_id == user.id`) แม้ย้ายห้องไปแล้ว
> `visibilityFilter` ใน DESIGN 4.3 **ไม่มีเงื่อนไขนี้** → ผูกกับหัวข้อ 12.1 (ดูคำถาม 3.1)

---

## 4. workflow (56 เคส) → `test/e2e/workflow.*.e2e-spec.ts` · สัปดาห์ 4–5

### assign (12)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 124 | `test_staff_assigns_technician_and_writes_log` | P | |
| 125 | `test_admin_can_assign_too` | **B** | DESIGN หัวข้อ 7 ให้ `/assign` = staff เท่านั้น (ดูคำถาม 2.10) |
| 126–127 | `test_only_staff_can_assign` ×2 | P | |
| 128 | `test_assign_requires_login` | P | |
| 129 | `test_cannot_assign_to_non_technician` | P | 400 |
| 130 | `test_cannot_assign_to_suspended_technician` | P | 400 |
| 131 | `test_assign_unknown_user_is_400` | P | |
| 132 | `test_assign_unknown_ticket_is_404` | P | |
| 133 | `test_reassign_resets_appointment_and_leaves_trail` | S | ขั้นไม่เปลี่ยน → ลง `ticket_audit_logs` action `reassign` ไม่ใช่ status log |
| 134 | `test_reassign_takes_ticket_away_from_previous_technician` | P | |
| 135 | `test_assigning_same_technician_twice_is_409` | P | |
| 136 | `test_cannot_assign_resolved_ticket` | S | DESIGN เปิด `resolved → assigned` ให้ reopen → ต้องแยกว่า `/assign` ยัง 409 แต่ `/reopen` ได้ |

### schedule (7)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 137 | `test_technician_schedules_own_job` | S | เดิม `assigned → scheduled` (เปลี่ยนสถานะ) · DESIGN ตัดสถานะ `scheduled` → `PATCH /schedule` ลง audit log |
| 138 | `test_technician_cannot_schedule_someone_elses_job` | P | 403 |
| 139 | `test_staff_can_schedule_any_job` | P | |
| 140 | `test_student_cannot_schedule` | P | |
| 141 | `test_schedule_in_the_past_is_400` | P | |
| 142 | `test_reschedule_keeps_every_appointment_in_the_log` | S | ย้ายไป `ticket_audit_logs` |
| 143 | `test_cannot_schedule_before_assigning` | P | |

### /status + reject (17)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 144 | `test_full_happy_path` | P* | ตัดขั้น `scheduled` ออกจากลำดับ |
| 145 | `test_technician_cannot_close_ticket` | P | **กฎหลักข้อ 2** |
| 146–147 | `test_status_endpoint_points_to_the_right_one` ×2 (assigned, scheduled) | S | `scheduled` ไม่มีแล้ว → เหลือ assigned / closed / rejected |
| 148 | `test_cannot_skip_straight_to_resolved` | P | |
| 149 | `test_pending_parts_requires_note` | P | `NOTE_REQUIRED` |
| 150 | `test_room_ticket_needs_permission_or_appointment` | **X** | พึ่ง `permission_to_enter` (ดูคำถาม 2.2) |
| 151 | `test_common_area_needs_no_permission` | **X** | เหมือนข้อ 150 |
| 152 | `test_technician_cannot_touch_unassigned_job` | P | ชั้น 2 ของช่าง |
| 153 | `test_student_cannot_change_status` | P | |
| 154 | `test_staff_cannot_do_technician_steps` | P | |
| 155 | `test_staff_rejects_new_ticket_with_reason` | P* | ย้ายไป `POST /reject` |
| 156 | `test_technician_cannot_reject` | P | |
| 157 | `test_cannot_reject_after_assigned` | **S** | **DESIGN เปิด `assigned → rejected`** → เทสเดิมขัดกับ DESIGN ตรง ๆ |
| 158 | `test_rejected_is_terminal` | P | |
| 159 | `test_failed_transition_writes_nothing` | P | **เทสทรานแซกชันหลัก** |
| 160 | `test_soft_deleted_ticket_is_404` | P | |

### priority (7)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 161 | `test_staff_raises_priority_and_sla_shrinks` | **X** | ไม่มี `sla_due_at` (คำถาม 2.4) |
| 162 | `test_lowering_priority_extends_sla` | **X** | เหมือนกัน |
| 163 | `test_priority_change_never_shortens_below_existing_due` | **X** | เหมือนกัน |
| 164 | `test_same_priority_is_409` | P | |
| 165–166 | `test_only_staff_changes_priority` ×2 | P | |
| 167 | `test_cannot_change_priority_of_closed_ticket` | P | |
| — | ปรับ priority ลง `ticket_audit_logs` ไม่ใช่ status log | **ใหม่** | แทนที่ `priority_to` เดิม |

### confirm (13)

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 168 | `test_room_owner_confirms_and_ticket_closes` | P* | + `close_reason = user_confirmed` |
| 169 | `test_roommate_can_confirm` | P | |
| 170 | `test_other_room_student_cannot_confirm` | P | |
| 171 | `test_technician_cannot_confirm` | P | |
| 172 | `test_technician_living_in_the_dorm_still_cannot_confirm` | P | **กันสองชั้น** |
| 173 | `test_staff_cannot_confirm_room_ticket` | P | **กฎหลักข้อ 2** |
| 174 | `test_common_area_is_confirmed_by_staff_not_students` | P* | + `close_reason = staff_confirmed` |
| 175 | `test_cannot_confirm_before_resolved` | P | |
| 176 | `test_cannot_confirm_twice` | P | |
| 177 | `test_closed_ticket_frees_the_asset_for_a_new_report` | P | |
| 178 | `test_priority_and_status_both_land_in_one_history` | S | แยกสองตารางแล้ว → `GET /history` ต้อง merge สองแหล่ง |
| 179 | `test_priority_log_row_is_marked_with_priority_to` | S | `priority_to` ไม่มีแล้ว |
| — | reopen: `resolved → assigned`, คงช่างเดิม, note บังคับ, `reopen_count += 1` | **ใหม่** | DESIGN 3.3 (เฟส B) |

---

## 5. auto-close job (18 เคส) → สัปดาห์ 5

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 180 | `test_closes_ticket_nobody_confirmed` | P* | + `close_reason = auto_closed` |
| 181 | `test_auto_close_writes_a_log_with_no_actor` | P | `actor_id = NULL` |
| 182 | `test_does_not_touch_tickets_inside_the_grace_period` | P | 3 วัน |
| 183–185 | `test_only_resolved_tickets_are_closed` ×3 (new / assigned / in_progress) | P* | `new` → `open` |
| 186 | `test_skips_soft_deleted_tickets` | P | |
| 187 | `test_running_twice_closes_nothing_the_second_time` | P | idempotent |
| 188 | `test_user_confirmed_tickets_keep_their_confirmer` | P | |
| 189 | `test_auto_closed_ticket_frees_the_asset` | P | |
| 190 | `test_closes_several_tickets_in_one_run` | P* | ใหม่ `LIMIT 100 FOR UPDATE SKIP LOCKED` |
| 191 | `test_ignores_resolved_at_when_status_moved_on` | P | |
| 192 | `test_admin_can_trigger_the_job` | **B** | DESIGN ไม่มี endpoint สั่งรัน (ดูคำถาม 2.5 — จำเป็นตอนเดโม) |
| 193 | `test_dry_run_changes_nothing` | **B** | เหมือนกัน |
| 194–196 | `test_only_admin_can_trigger_the_job` ×3 | **B** | เหมือนกัน |
| 197 | `test_job_requires_login` | **B** | เหมือนกัน |
| — | ใบส่วนกลางที่มี `disputed_at` → job ข้าม | **ใหม่** | DESIGN 3.4 |
| — | confirm ชนกับ job พร้อมกัน → log `resolved → closed` แถวเดียว | **ใหม่** | DESIGN 10 หมวด concurrency |

---

## 6. reports (30 เคส) → สัปดาห์ 5

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 198 | `test_summary_groups_by_building_and_category` | **B** | DESIGN ตัด `tickets.building` + `tickets.category` (ดูคำถาม 2.11) |
| 199 | `test_summary_counts_closed_rejected_and_open` | P | |
| 200 | `test_summary_separates_auto_closed_from_user_confirmed` | P* | ใหม่แยกด้วย `close_reason` 3 ค่า แม่นกว่า `confirmed_by IS NULL` |
| 201 | `test_summary_counts_overdue_and_breached` | **X** | ไม่มี `sla_due_at` (คำถาม 2.4) |
| 202 | `test_summary_average_hours_to_close` | P* | DESIGN แยกเป็น "เวลาซ่อม" (จบที่ resolved) + "เวลารอยืนยัน" |
| 203 | `test_summary_filters` | **B** | ผูกกับข้อ 198 |
| 204 | `test_empty_report_is_zeroed_not_an_error` | P | |
| 205–210 | `test_reports_are_staff_only` ×6 (3 url × 2 role) | P | |
| 211–213 | `test_reports_require_login` ×3 | P | |
| 214 | `test_admin_can_read_reports` | P | |
| 215 | `test_stage_durations_read_from_logs` | P* | ใหม่อ่านจาก `v_ticket_stage_durations` |
| 216 | `test_priority_change_rows_do_not_split_a_stage` | S | โครงสร้างใหม่กันไว้แล้ว (`ck_real_transition` + audit แยกตาราง) → เขียนเป็น contract test แทน |
| 217 | `test_stage_durations_count_tickets_still_waiting` | P | |
| 218 | `test_closed_tickets_are_not_counted_as_waiting` | **B** | view ใหม่ใช้ `COALESCE(LEAD(...), now())` → ขั้น `closed` จะโตเรื่อย ๆ (ดูคำถาม 2.12) |
| 219 | `test_rejected_tickets_are_not_counted_as_waiting` | **B** | เหมือนข้อ 218 |
| 220 | `test_stage_durations_respect_filters` | **B** | ผูกกับข้อ 198 |
| 221 | `test_technician_workload` | P | |
| 222 | `test_resolve_time_counts_from_assignment_not_from_report` | P | |
| 223 | `test_reassignment_attributes_time_to_the_new_technician` | S | เดิมอ่านจากแถว from=to ใน status log · ใหม่ต้องอ่านจาก `ticket_audit_logs` action `reassign` |
| 224 | `test_late_resolved_is_counted` | **X** | พึ่ง `sla_due_at` |
| 225 | `test_reassignment_does_not_split_the_assigned_stage` | S | เหมือนข้อ 223 |
| 226 | `test_priority_change_does_not_look_like_a_new_assignment` | S | เหมือนข้อ 216 |
| 227 | `test_reports_skip_soft_deleted_tickets` | P | **ห้ามลบเทสนี้** — `manager.query()` ไม่กรอง `@DeleteDateColumn` |
| — | ใบที่ถูก reopen ต่อช่าง + SLA หยุดนับช่วง `pending_parts` | **ใหม่** | DESIGN 9 |

---

## 7. QR / scan (15 เคส) → สัปดาห์ 5

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 228 | `test_qr_holds_only_a_scan_url` | P* | เดิม QR บรรจุ `/scan/<asset_code \| room_code>` · DESIGN ใช้ `assets.qr_token` |
| 229 | `test_url_endpoint_reports_what_the_sticker_points_to` | **B** | DESIGN ไม่มี `/qr/:code/url` |
| 230 | `test_room_code_resolves_to_a_room` | **B** | DESIGN ไม่มี `qr_token` บน `rooms` → QR หน้าห้องหายไป (ดูคำถาม 2.3) |
| 231 | `test_png_is_a_real_png` | P* | `GET /assets/:id/qr` |
| 232 | `test_svg_format` | **B** | DESIGN ระบุแค่ png |
| 233 | `test_unknown_code_is_404` | P | |
| 234 | `test_deleted_asset_has_no_qr` | P | |
| 235 | `test_qr_requires_login` | P | |
| 236 | `test_sheet_lists_every_sticker_to_print` | **B** | DESIGN ไม่มี `/qr/sheet` (ใบพิมพ์รวม) |
| 237 | `test_sheet_can_filter_kind` | **B** | เหมือนกัน |
| 238–239 | `test_sheet_is_staff_only` ×2 | **B** | เหมือนกัน |
| 240 | `test_scan_page_opens_without_login` | **B** | เดิม `/scan/{code}` เปิดได้ไม่ต้อง login · DESIGN หัวข้อ 7 ให้ `GET /scan/:qrToken` = "ทุก role" (= ต้องมี token) |
| 241 | `test_scan_page_carries_no_data_of_its_own` | **B** | เหมือนข้อ 240 |
| 242 | `test_scan_page_of_unknown_code_still_opens` | **B** | เดิม **ไม่** เช็คว่ารหัสมีจริง (กันไล่เดารหัสครุภัณฑ์) · DESIGN ให้ตอบ 404 |

---

## 8. smoke / contract (10 เคส) → `test/contract/schema-vs-code.spec.ts` · สัปดาห์ 1

| # | เทสเดิม | ป้าย | หมายเหตุ |
|---|---|---|---|
| 243 | `test_health_endpoint` | P | |
| 244 | `test_ticket_room_scope_requires_room` | P | `ck_scope_room` |
| 245 | `test_ticket_common_area_must_not_have_room` | P | |
| 246 | `test_ticket_common_area_without_room_is_ok` | P | |
| 247 | `test_cannot_close_without_resolve` | S | เดิม `ck_tickets_closed_after_resolved` · DESIGN ใช้ `ck_closed` (closed → ต้องมี `closed_at` + `close_reason`) แต่ **ไม่บังคับ `resolved_at`** (ดูคำถาม 2.13) |
| 248 | `test_status_logs_cascade_on_delete` | **B** | DESIGN DDL ไม่ระบุ `ON DELETE` (ดูคำถาม 2.14) |
| 249 | `test_cannot_jump_from_new_to_closed` | P* | `open → closed` |
| 250 | `test_technician_path_stops_at_resolved` | P | |
| 251 | `test_closed_and_rejected_are_terminal` | P | |
| 252 | `test_open_statuses_exclude_terminal` | P | **ห้ามลบ** — คู่กับ contract test ที่อ่าน `pg_indexes.indexdef` ของ `idx_tickets_asset_open` |

---

## สรุปจำนวนตามป้าย (ก่อนได้คำตอบ 5 ต.ค.)

| ป้าย | เคส |
|---|---|
| `P` / `P*` แปลได้เลย | **176** |
| `S` superseded (เขียนใหม่ มีของมาแทน) | **18** |
| `X` ตกไป (คอลัมน์ / ฟีเจอร์ไม่มีใน DESIGN) | **14** |
| `B` blocked รอคำตอบ | **44** |
| รวม | **252** |

---

# ภาคผนวก — ผลของการตัดสินใจ 5 ต.ค. 2569

คำตอบใน DESIGN หัวข้อ 12.1 เปลี่ยนป้ายของ 44 เคสที่ติด `B` และของอีก 6 เคสที่เคยติด `X`
ตารางข้างบนคงไว้เป็นบันทึก ป้ายที่ใช้จริงคือตารางนี้

## เคสที่คลายล็อกแล้ว

| เคส | เดิม | ใหม่ | เหตุผล |
|---|---|---|---|
| 9 `request_code_rate_limited_per_ip` | B | **P** | ต่อ IP = 30/ชม. ตรงกับของเดิม ไม่ต้องแก้ค่าคาด |
| 43 `delete_room_in_use_is_409` | X | **P** | `rooms.capacity` กลับมาแล้ว |
| 64 `full_room_is_409` | X | **P** | เหมือนกัน + ต้องเพิ่มเทส lock แถว `rooms` ตอนผูกห้องพร้อมกัน |
| 71 `permission_to_enter_is_saved` | X | **P** | คอลัมน์กลับมาแล้ว |
| 150 `room_ticket_needs_permission_or_appointment` | X | **P** | กฎกลับมาแล้ว (DESIGN 6.7) |
| 151 `common_area_needs_no_permission` | X | **P** | เหมือนกัน — `ck_permission_scope` บังคับที่ DB ด้วย |
| 101–105 โควตา 5 เคส | B | **S** | กฎเปลี่ยนเป็น "ใบเปิดรวมไม่เกิน 10 ใบ" → เขียนใหม่ 5 เคส + เทส concurrency ที่ของเดิมไม่มี |
| 114 `student_cannot_view_other_room_ticket` | B | **S** | 403 → 404 (ชั้น 0) |
| 116 `technician_sees_only_assigned` | B | **S** | เหมือนกัน |
| 109 `same_issue_on_other_room_is_403` | P | **S** | ชั้น 0 ครอบทุก endpoint → ใบห้องอื่นมองไม่เห็น ตอบ **404** ไม่ใช่ 403 |
| 248 `status_logs_cascade_on_delete` | B | **S** | ตัดสิน 6 ต.ค.: FK เป็น `NO ACTION` ทุกตัว ห้าม `CASCADE` — ระบบใช้ soft delete อย่างเดียว การลบจริงต้อง error ทันที ถ้า cascade แล้วมีคนลบ ticket/user จริง `ticket_status_logs` กับ audit log จะหายตามโดยไม่มีอะไรบอก (ประวัติคือจุดขายของระบบ) → เทสกลับด้าน: `DELETE` ใบที่มี log ต้องได้ **23503** · `TRUNCATE … CASCADE` ในเทสยังใช้ได้เพราะไม่ขึ้นกับ `ON DELETE` |
| 54 `asset_filters_and_qr_lookup` | B | **S** | `/assets/by-code` ถูกแทนด้วย `GET /scan/:qrToken` (DESIGN 6.8) ส่วน filter ยังแปลตรง ๆ |
| 192 `admin_can_trigger_the_job` | B | **P\*** | `POST /admin/jobs/auto-close/run` |
| 194–197 `only_admin_can_trigger` ×3 + `job_requires_login` | B | **P\*** | เหมือนกัน |
| 198 `summary_groups_by_building_and_category` | B | **P\*** | จัดกลุ่มผ่าน join `assets.building_id` / `assets.category` (DESIGN 9.1) |
| 203 `summary_filters` | B | **P\*** | เหมือนกัน |
| 220 `stage_durations_respect_filters` | B | **P\*** | เหมือนกัน |
| 201 `summary_counts_overdue_and_breached` | X | **P\*** | คิดจาก `SLA_TARGET_HOURS` ตอนออกรายงาน แทนการอ่าน `sla_due_at` |
| 224 `late_resolved_is_counted` | X | **P\*** | เหมือนกัน |
| 218 `closed_tickets_are_not_counted_as_waiting` | B | **P** | DESIGN 2.3 ระบุให้รายงานกรอง terminal stage แล้ว |
| 219 `rejected_tickets_are_not_counted_as_waiting` | B | **P** | เหมือนกัน + เพิ่มเคส `cancelled` |
| 240 `scan_page_opens_without_login` | B | **P** | หน้า HTML ยังเปิดได้ไม่ต้อง login (DESIGN 6.8) |
| 241 `scan_page_carries_no_data_of_its_own` | B | **P** | เหมือนกัน |
| 242 `scan_page_of_unknown_code_still_opens` | B | **P** | หน้า HTML ไม่เช็ครหัส — 404 อยู่ที่ API ไม่ใช่หน้าเว็บ |

## เคสที่ตกไปถาวร (ยืนยันแล้ว)

| เคส | เหตุผล |
|---|---|
| 82, 87–88, 98 ใบไม่มี asset 4 เคส | ตัดสิน 6 ต.ค. (DESIGN 12.2 ทางเลือก ก.): `asset_id NOT NULL` ทุกใบต้องชี้ครุภัณฑ์ — ปัญหาที่ไม่ผูกชิ้นใช้ asset ทั่วไปตามหมวด |
| 89 `retired_asset_is_400` | ไม่มี `asset_status` — เลิกใช้ใช้ `deleted_at` |
| 161–163 priority ↔ SLA 3 เคส | ไม่เก็บ `sla_due_at` เป็นคอลัมน์ (DESIGN 9.2) |
| 113 `escalation_never_extends_sla` | เหมือนกัน |
| 124 `is_overdue_on_sqlite` | เป็นบั๊กของ SQLite + `sla_due_at` |
| 193 `dry_run_changes_nothing` | endpoint ใหม่ไม่รับพารามิเตอร์ใด ๆ |
| 229 `url_endpoint_reports_what_the_sticker_points_to` | ไม่มี `/qr/:code/url` |
| 230 `room_code_resolves_to_a_room` | QR ระดับห้องไม่มี — `qr_token` อยู่บน `assets` เท่านั้น |
| 232 `svg_format` | เสิร์ฟ png อย่างเดียว |
| 236–239 `/qr/sheet` 4 เคส | ใบพิมพ์ QR รวมอยู่นอกขอบเขต (DESIGN 6.8) |
| 42 `moving_room_building_moves_its_assets` | `building` เป็น FK แล้ว ไม่มีอะไรต้องย้ายตาม |

## เคสที่ยังติด `B` — 3 เคส

| เคส | รอข้อไหน |
|---|---|
| 125 `admin_can_assign_too` | DESIGN 12.3 ข้อ 2 — admin ทำ `/assign` `/reject` ได้หรือไม่ |
| 119 `list_filters` | DESIGN 12.3 ข้อ 7 — query param ของ `GET /tickets` |
| 19 `inactive_user_cannot_login` | verify-code ของบัญชีที่ถูกระงับ → 403 (เดิม) หรือ 401 |

## เคสใหม่ที่ต้องเพิ่ม (ไม่มีในของเดิม)

| กลุ่ม | เคส |
|---|---|
| `cancelled` | ผู้แจ้งยกเลิกตอน `open` สำเร็จ · คนในห้องที่ไม่ใช่ผู้แจ้งยกเลิกไม่ได้ (403) · ยกเลิกตอน `assigned` → 409 · ยกเลิกแล้วแจ้ง asset ชิ้นเดิมใหม่ได้ · `cancelled` ไม่โดน job ปิด · รายงานแยก `cancelled` จาก `rejected` |
| โควตา | ใบเปิดครบ 10 ใบ → 429 `QUOTA_EXCEEDED` · ปิดใบแล้วโควตาคืน · batch 2 ชุดพร้อมกันต้องไม่ทะลุ 10 (lock แถว `users`) · staff ไม่มีโควตา |
| `VIA_ACTION` | student เรียก `/reopen` ได้ แต่เรียก `/assign` ไม่ได้ ทั้งที่ปลายทางเป็น `assigned` ทั้งคู่ |
| ชั้น 0 (404) | ทุก action endpoint บนใบที่มองไม่เห็น → 404 · ผู้แจ้งที่ย้ายห้องแล้วยัง `/cancel` ใบตัวเองได้ |
| contract | predicate ของ `idx_tickets_reporter_open` ตรงกับ `OPEN_STATUSES` · `cancelled` ไม่อยู่ใน `OPEN_STATUSES` · `VIA_ACTION` ครอบ `Endpoint` ทุกค่า |
| เวลาไทย | ใบที่แจ้ง 02:00 ของวันที่ 1 ต้องตกเดือนใหม่ ไม่ใช่เดือนก่อน (`date_trunc` + `AT TIME ZONE`) |
| rate limit | ต่อ IP 30/ชม. ไม่ล็อกคนที่ 6 ของหอ · verify ต่อ IP 60/ชม. |

## สรุปใหม่

| ป้าย | เคส |
|---|---|
| `P` / `P*` แปลได้เลย | **199** |
| `S` superseded | **30** |
| `X` ตกไปถาวร | **20** |
| `B` ยังรอคำตอบ | **3** |
| รวม | **252** |

+ เคสใหม่ประมาณ 25 เคสจากตาราง "เคสใหม่ที่ต้องเพิ่ม"

---

# ความคืบหน้าการแปล

## สัปดาห์ 1 — หมวด 8 smoke / contract (แปลครบ 10 จาก 10)

| เคส | อยู่ที่ |
|---|---|
| 243 `health_endpoint` | `test/e2e/health.e2e-spec.ts` |
| 244–246 `ck_scope_room` 3 เคส | `test/contract/schema-vs-code.spec.ts` |
| 247 `cannot_close_without_resolve` (S) | `test/contract/schema-vs-code.spec.ts` — แยกเป็น `ck_closed` + `ck_closed_after_resolved` |
| 249–252 status machine 4 เคส | `src/domain/status-rules.spec.ts` |
| 248 `status_logs_cascade_on_delete` (S) | `test/contract/schema-vs-code.spec.ts` — กลับด้านเป็น "ลบใบที่มี log ไม่ได้ (23503)" |

เคสใหม่จากตาราง contract ที่ทำแล้ว: predicate ของ `idx_tickets_reporter_open` · `cancelled` ไม่อยู่ใน `OPEN_STATUSES` ·
`VIA_ACTION` ครอบ `Endpoint` ทุกค่า (ส่วน "ทุก action มีกรณีใน `TicketPolicy.assertCan`" รอสัปดาห์ 3)

## สัปดาห์ 2 — หมวด 1 auth (33) + หมวด 2 users / rooms / buildings / assets (32)

ไฟล์เทส: `test/e2e/auth.e2e-spec.ts` · `users.e2e-spec.ts` · `rooms.e2e-spec.ts` (รวม buildings) · `assets.e2e-spec.ts`
ทุกเคสที่แปลมีคอมเมนต์ `// @parity <ชื่อเทสเดิม>` หรือ `// @superseded <ชื่อเทสเดิม>` กำกับในไฟล์

### auth — แปลครบ 33 เคส

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 1–5, 8, 10, 12, 20–23, 25, 27–30 | P | ไม่ต่าง |
| 6 `code_is_stored_hashed_not_plain` | P* | HMAC ด้วย `OTP_SECRET` แยกจาก `JWT_SECRET` + เทสเพิ่มว่าไม่ใช่ sha256 เปล่า |
| 7 `email_is_normalized_to_lowercase` | P* | ขอด้วยตัวใหญ่ ยืนยันด้วยตัวเล็ก ได้บัญชีเดียว (DTO แปลงเป็นตัวเล็ก + คอลัมน์ `citext`) |
| 8 `rate_limited_per_email` | P* | มีช่วงพัก 60 วินาทีเพิ่มจากของเดิม เทสจึงขยับ `created_at` ระหว่างคำขอ |
| 9 `rate_limited_per_ip` | P | เดิมลดเพดานด้วย monkeypatch · ใหม่ยิงครบ 30 ครั้งจริง |
| 11 `first_login_auto_provisions_student` | P* | ไม่มี `student_id` / `email_verified_at` / `last_login_at` ใน schema ใหม่ |
| 13 `wrong_code_counts_attempts_then_locks` | P* | รหัสผิดตอบ **401** `INVALID_CODE` (เดิม 400) · ล็อกแล้ว **429** `CODE_LOCKED` เหมือนเดิม |
| 14–17 หมดอายุ / ใช้ซ้ำ / รหัสเก่า / ไม่เคยขอ | P* | ตอบ **401** (เดิม 400) — DESIGN ตาราง 7 ให้ verify-code ตอบ 400 เฉพาะ validate |
| 18 `verify_bad_code_format_is_400` | P | + เช็คว่าไม่นับ `attempts` |
| 19 `inactive_user_cannot_login` | **B → ทำเป็น 401 ไว้ก่อน** | เดิม 403 · ใช้ **401** `ACCOUNT_DISABLED` ให้ตรงกับ guard — **รอยืนยัน** ถ้าต้องการ 403 แก้บรรทัดเดียวใน `auth.service.ts` |
| 24 `me_rejects_expired_token` | P* | อายุ token 8 ชม. |
| 26 `suspended_after_login_blocked_immediately` | P* | guard ตอบ 401 (เดิม 403) |
| 31 `db_rejects_non_university_email` | P | อยู่ใน `test/contract/schema-vs-code.spec.ts` + ผ่าน HTTP ใน `error-handling.e2e-spec.ts` (23514 → 400) |
| 32–33 `dev_mode_prints_code` / `production_mode_never_prints_code` | S | ไม่มีโหมดพิมพ์รหัสแล้ว — dev ดูใน Mailpit, e2e อ่านจาก `FakeMailService` · เทสที่มาแทน: "ไม่เขียนรหัสลง log แม้ตอนส่งเมลล้มเหลว" |

เคสใหม่ของ auth (ไม่มีในของเดิม): ช่วงพัก 60 วินาที + `Retry-After` · คนที่ 6 ของหอยังขอรหัสได้ ·
verify ต่อ IP 60/ชม. · บัญชีถูกลบแบบ soft แล้ว login ได้บัญชีใหม่ · JWT มีแค่ `sub` ·
token แบบ `alg=none` / `sub` ไม่ใช่ uuid → 401 · ส่งเมลล้มเหลวหรือค้างก็ตอบ 202 ·
**concurrency 3 เคส**: รหัสผิดพร้อมกัน 20 request · รหัสถูกพร้อมกัน 2 request · ขอรหัสพร้อมกัน 10 request

### rooms / buildings — แปลครบ 12 เคส

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 34 `anyone_logged_in_can_read_rooms` | P* | ตัด `/rooms/by-code` — schema ใหม่ไม่มี `room_code` |
| 35–37, 40, 41, 44, 45 | P | ไม่ต่าง |
| 38 `staff_creates_room` | P* | ส่ง `building_id` · ไม่มี `is_active` ของห้อง |
| 39 `duplicate_room_is_409` | P* | `uq_rooms_no (building_id, room_no)` + เลขเดิมสร้างใหม่ได้หลัง soft delete |
| 42 `moving_room_building_moves_its_assets` | **X → P\*** | ป้าย X เดิมผิด: `assets.building_id` ยังเก็บซ้ำอยู่ (ครุภัณฑ์ส่วนกลางไม่มีห้องให้ join) ย้ายห้องข้ามอาคารจึงต้องพาครุภัณฑ์ในห้องตามไปเหมือนของเดิม |
| 43 `delete_room_in_use_is_409` | P | `rooms.capacity` กลับมาแล้ว |

เคสใหม่: CRUD ของ `/buildings` (ของเดิมไม่มีตารางนี้) · อาคารที่ถูก soft delete → 400 · ลด `capacity` ต่ำกว่าผู้พัก → 409

### assets — แปลครบ 9 เคส

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 46 `create_common_area_asset_needs_building` | P* | `building_id` |
| 47–52 | P | ไม่ต่าง |
| 53 `soft_delete_asset` | P | + ใหม่: ลบ asset ที่มีใบเปิด → 409 `ASSET_HAS_OPEN_TICKET` ครบทุกสถานะใน `OPEN_STATUSES` |
| 54 `asset_filters_and_qr_lookup` | S | ส่วน filter แปลแล้ว · ส่วน `/assets/by-code` รอ `GET /scan/:qrToken` สัปดาห์ 5 |

เคสใหม่: `qr_token` สุ่ม 128 บิต ผู้ใช้กำหนดเองไม่ได้ และส่งให้เฉพาะ staff / admin

### users — แปลครบ 11 เคส

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 55–57, 60, 61, 63, 64 | P | ไม่ต่าง |
| 58 `student_cannot_list_users` | P | + staff ก็ได้ 403 ตาม DESIGN ตาราง 7 (ดูข้อ 65) |
| 59 `staff_assigns_room_then_student_can_report` | **P ครึ่งเดียว** | ครึ่ง "ผูกห้องได้" แปลแล้ว · ครึ่ง "แจ้งห้องได้หลังผูก" ต้องมี `POST /tickets` → **สัปดาห์ 3** |
| 62 `admin_changes_role_and_suspends` | P* | token ของคนที่ถูกระงับได้ 401 (เดิม 403) · เปลี่ยนเป็น `staff` แทน `technician` ในเทสเดิม เพราะกฎใหม่ของช่าง |
| 65 `list_users_filters` | P* | เดิมเรียกด้วย **staff** · DESIGN ตาราง 7 ให้ `GET /users` = admin เท่านั้น → เรียกด้วย admin — **รอยืนยัน** |
| `DELETE /users/:id` → 204 | ใหม่ | ทำแล้ว |

เคสใหม่จากกฎที่ตัดสินสัปดาห์นี้ (DESIGN 4.4):
- ช่างผูกห้องไม่ได้ — API 400 + `ck_technician_no_room` (มีเทสปิดด่าน API แล้วยิงผ่าน HTTP: DB ต้องตอบ 400 ไม่ใช่ 500)
- ระงับ / ลบ / เปลี่ยน role ของช่างที่มีใบค้าง → 409 `TECHNICIAN_HAS_OPEN_TICKETS` + `details.tickets`
- ผูกสองคนเข้าห้องที่เหลือ 1 ที่พร้อมกัน → 200 กับ 409 (concurrency)
- staff ส่งฟิลด์อื่นนอกจาก `room_id` → 403 พร้อม `details.fields`

### เคสของสัปดาห์อื่นที่ป้ายเปลี่ยนเพราะการตัดสินสัปดาห์นี้

| เคส | เดิม | ใหม่ | เหตุผล |
|---|---|---|---|
| 172 `technician_living_in_the_dorm_still_cannot_confirm` | P | **S** | ช่างมี `room_id` ไม่ได้แล้ว (`ck_technician_no_room`) สถานการณ์นี้สร้างไม่ได้ตั้งแต่ระดับข้อมูล → สัปดาห์ 4 เขียนเป็น "ช่างกด `/confirm` → 403 ที่ชั้น 1" |

### สรุปป้ายหลังสัปดาห์ 2

| ป้าย | เคส |
|---|---|
| `P` / `P*` | **199** (−1 ข้อ 172 ไป S · +1 ข้อ 42 กลับมาจาก X) |
| `S` superseded | **31** |
| `X` ตกไปถาวร | **19** |
| `B` ยังรอคำตอบ | **3** — 19 (ทำเป็น 401 ไว้ก่อน), 119, 125 |
| รวม | **252** |

แปลแล้วสะสม: หมวด 8 (10) + หมวด 1 (33) + หมวด 2 (32, ข้อ 59 ครึ่งเดียว) = **75 จาก 252**

## สัปดาห์ 3 — หมวด 3 tickets (58 เคส)

ไฟล์เทส: `test/e2e/tickets.e2e-spec.ts` (95 เคส) · `src/modules/tickets/ticket-policy.service.spec.ts` (ตารางสิทธิ์ ไม่ใช้ DB)
คำตอบที่ใช้ (6 ต.ค. 2569): `/same-issue` = student เท่านั้น · ยกระดับ urgent ครั้งเดียวต่อใบ ·
query param ของ `GET /tickets` ชุดเดียวกับของเดิม · `GET /users` = staff + admin

### สร้างแบบ batch (9)

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 66 `batch_creates_separate_tickets_sharing_batch_id` | P* | `open` / `normal` / `building_id` · รายการที่ 3 ใช้ครุภัณฑ์จริงแทนใบไม่มี asset |
| 67 `every_ticket_gets_initial_status_log` | P* | `NULL → open` + เช็ค `ticket_reporters` |
| 68 `single_item_has_no_batch_id` | S | ใบเดี่ยวก็มี `batch_id` ของตัวเอง |
| 69 `ticket_no_continues_from_existing` | S | เดินต่อจาก `ticket_counters` + เทส "batch 2 ชุดพร้อมกันเลขไม่ชนไม่ข้าม" + "รายการที่ซ้ำไม่กินเลข" |
| 70 `asset_fills_in_room_and_building` | P* | ส่งแค่ `asset_id` พอ — `scope` / `room_id` ไม่บังคับ |
| 71 `permission_to_enter_is_saved` | P | + ใช้กับส่วนกลาง → 400 |
| 72–74 | P | ไม่ต่าง |

### สิทธิ์ตอนสร้าง (16)

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 75–81, 83–86, 90 | P | ไม่ต่าง (76 เพิ่ม admin → 403 ตามตาราง 7) |
| 77 `layer2_cannot_report_other_room` | P | + **เทสกันข้อมูลรั่ว**: ครุภัณฑ์ห้องอื่นที่มีใบเปิดอยู่ต้องได้ 403 ไม่ใช่ 409 และ body ไม่มี `ticket_no` |
| 82, 87–88 | X | ใบไม่มี asset — ตกไปตาม DESIGN 12.2 |
| 89 `retired_asset_is_400` | X | ไม่มี `asset_status` |

### กันแจ้งซ้ำ (10)

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 91 `duplicate_single_item_is_409_with_ticket_no` | P* | body เป็น `{ code: DUPLICATE_OPEN_TICKET, details: { skipped: [{ asset_id, ticket_no, ticket_id }] } }` |
| 92–93 | P | `skipped[]` ไม่มี `index` แล้ว ใช้ `asset_id` ระบุรายการ |
| 94–95 `resolved_and_pending_parts_still_block` | P | ขยายเป็นทุกค่าใน `OPEN_STATUSES` (5 เคส) |
| 96–97 `closed_or_rejected_does_not_block` | P | + `cancelled` |
| 98 `items_without_asset_are_never_duplicates` | X | ใบไม่มี asset |
| 99–100 เขียนตรงที่ DB | P | อยู่ใน `test/contract/schema-vs-code.spec.ts` ตั้งแต่สัปดาห์ 1 |

เคสใหม่: แจ้งครุภัณฑ์เดียวกันพร้อมกัน 10 request → 201 หนึ่งตัว 409 เก้าตัว · batch 2 ชุดสลับลำดับพร้อมกันไม่ deadlock

### โควตา (5) — เขียนใหม่ทั้งหมด

| เคส | ป้ายที่ใช้จริง | เทสที่มาแทน |
|---|---|---|
| 101 `student_daily_limit` | S | ใบเปิดครบ 10 ใบ → 429 `QUOTA_EXCEEDED` |
| 102 `batch_exceeding_quota_is_rejected_whole` | S | ถูกปฏิเสธทั้งชุด ไม่มีใบ / log / เลขใบค้าง |
| 103 `skipped_items_do_not_use_quota` | S | รายการที่ซ้ำไม่กินโควตา |
| 104 `staff_has_no_daily_limit` | S | staff ไม่มีโควตา |
| 105 `quota_window_is_rolling_24h` | S | ใบที่ closed / rejected / cancelled คืนโควตา — เวลาผ่านไปเฉย ๆ ไม่คืน |

เคสใหม่: นับรวมใบห้องพักกับส่วนกลาง · **batch 2 ชุดพร้อมกันไม่ทะลุ 10 ใบ** (lock แถว `users`)

### same-issue (8)

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 106, 108, 110 | P | 108 เพิ่ม rejected / cancelled |
| 107 `same_issue_by_reporter_is_409` | P* | ผ่าน `ticket_reporters` — code `ALREADY_REPORTED` |
| 109 `same_issue_on_other_room_is_403` | S | ใบห้องอื่นมองไม่เห็น → **404** |
| 111 `technician_cannot_press_same_issue` | P | + staff / admin → 403 (student เท่านั้น) |
| 112 `report_count_over_threshold_escalates_to_urgent` | P* | ไม่มี `sla_due_at` · มี audit `auto_escalate` โดยระบบ |
| 113 `escalation_never_extends_sla` | X | ไม่มี `sla_due_at` |

เคสใหม่: กดซ้ำคนเดิม → 409 · กดรัวพร้อมกัน 8 ครั้งนับครั้งเดียว · หลายคนกดพร้อมกันไม่มี lost update ·
ยกระดับครั้งเดียวต่อใบ · ผู้แจ้งที่ย้ายห้อง → 403 ไม่ใช่ 409 · `disputed_at` ของใบส่วนกลางที่ resolved

### visibility (10)

| เคส | ป้ายที่ใช้จริง | สิ่งที่ต่างจากของเดิม |
|---|---|---|
| 114 `student_cannot_view_other_room_ticket` | S | **404** และ body เหมือนใบที่ไม่มีอยู่ทุกตัวอักษร |
| 115, 117, 118, 121 | P | ไม่ต่าง |
| 116 `technician_sees_only_assigned` | S | **404** |
| 119 `list_filters` | **B → P\*** | ตัดสินแล้ว: ชุดเดียวกับของเดิม · `building` → `building_id` |
| 120 `detail_includes_status_logs` | P* | `to_status = open` |
| 122 `timestamps_are_utc_aware` | P* | ไม่มี `sla_due_at` |
| 123 `is_overdue_on_sqlite` | X | บั๊กของ SQLite + `sla_due_at` |

เคสใหม่: ผู้แจ้งที่ย้ายห้องยังเห็นใบตัวเอง · ตัวกรองไม่ช่วยให้เห็นใบที่มองไม่เห็น ·
**`canSee` ตรงกับ `visibilityFilter` ทุกคู่ (ผู้ใช้, ใบ)** · ใบของครุภัณฑ์ที่ถูก soft delete ยังอ่านได้

### เคสของสัปดาห์ก่อนที่เปลี่ยนเพราะคำตอบรอบนี้

| เคส | เดิม | ใหม่ | เหตุผล |
|---|---|---|---|
| 59 `staff_assigns_room_then_student_can_report` | P ครึ่งเดียว | **P ครบ** | ครึ่งหลังอยู่ใน `tickets.e2e-spec.ts` |
| 65 `list_users_filters` | P* (เรียกด้วย admin) | **P** | `GET /users` เปิดให้ staff แล้ว เรียกด้วย staff เหมือนของเดิม |

### สรุปป้ายหลังสัปดาห์ 3

| ป้าย | เคส |
|---|---|
| `P` / `P*` | **200** (+1 ข้อ 119 จาก B) |
| `S` superseded | **31** |
| `X` ตกไปถาวร | **19** |
| `B` ยังรอคำตอบ | **2** — 19 (ทำเป็น 401 ไว้ก่อน), 125 (admin ทำ `/assign` ได้หรือไม่ — ต้องตอบก่อนสัปดาห์ 4) |
| รวม | **252** |

แปลแล้วสะสม: หมวด 8 (10) + หมวด 1 (33) + หมวด 2 (32) + หมวด 3 (58) = **133 จาก 252**

## TODO ที่เลื่อนออกไป (อนุมัติ 6 ต.ค. 2569)

| เรื่อง | ทำเมื่อไหร่ | หมายเหตุ |
|---|---|---|
| ~~entity ของ TypeORM~~ | ~~สัปดาห์ 2~~ | **เสร็จแล้ว** — ครบ 11 ตาราง มี contract test เทียบคอลัมน์กับ DB |
| ~~เคส 59 ครึ่งหลัง~~ | ~~สัปดาห์ 3~~ | **เสร็จแล้ว** |
| `GET /tickets/:id/history` (รวม status log + audit log) | สัปดาห์ 4 | คู่กับเคส 178–179 — สัปดาห์ 3 ส่ง `status_logs` ใน `GET /tickets/:id` ไปก่อน |
| admin ทำ `/assign` `/reject` ได้หรือไม่ (เคส 125) | ต้องตอบก่อนสัปดาห์ 4 | ตอนนี้ `TicketPolicy` ให้ staff เท่านั้นตามตาราง 7 |
| `/assign` ต้อง lock แถว `users` ของช่างก่อนมอบงาน | สัปดาห์ 4 | คู่กับการเช็คใบค้างตอนระงับช่าง (DESIGN 4.4) |
| seed: audit log ของ assign / priority | สัปดาห์ 4 | ทำพร้อม workflow — ตอนนี้ seed เขียน `ticket_audit_logs` แค่ `same_issue` ของใบ disputed |
| seed: ใบแบบ batch (หลายใบ `batch_id` เดียวกัน) | สัปดาห์ 4 | ตอนนี้ทุกใบมี `batch_id` ของตัวเอง |
