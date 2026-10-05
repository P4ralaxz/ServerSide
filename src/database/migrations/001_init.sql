-- Schema ปลายทางตาม DESIGN หัวข้อ 2.2–2.3
-- ไฟล์นี้คือแหล่งความจริงของโครงสร้าง DB: partial index / trigger / view / CHECK ข้างล่าง
-- synchronize ของ TypeORM สร้างให้ไม่ได้ จึงปิดไว้และรัน SQL นี้ตรง ๆ
-- ใช้ timestamptz ทุกคอลัมน์: node-postgres แปลง timestamp แบบไม่มีโซนเป็นเวลาท้องถิ่นของ process

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role       AS ENUM ('student','technician','staff','admin');
CREATE TYPE ticket_scope    AS ENUM ('room','common_area');
-- cancelled = ผู้แจ้งถอนใบเอง (ต่างจาก rejected ที่ Staff ไม่รับเรื่อง) รายงานต้องแยกสองค่านี้
CREATE TYPE ticket_status   AS ENUM ('open','assigned','in_progress','pending_parts',
                                     'resolved','closed','rejected','cancelled');
CREATE TYPE ticket_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE close_reason    AS ENUM ('user_confirmed','staff_confirmed','auto_closed');
CREATE TYPE audit_action    AS ENUM ('assign','reassign','schedule','priority',
                                     'auto_escalate','same_issue','reopen');

CREATE TABLE buildings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX uq_buildings_code ON buildings(code) WHERE deleted_at IS NULL;

CREATE TABLE rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id),
  room_no     text NOT NULL,
  floor       int  NOT NULL,
  -- ใช้เช็ค "ห้องเต็ม" ตอน Staff ผูกห้องให้นักศึกษา → 409
  capacity    int  NOT NULL,
  deleted_at  timestamptz,
  CONSTRAINT ck_rooms_capacity CHECK (capacity > 0)
);
CREATE UNIQUE INDEX uq_rooms_no ON rooms(building_id, room_no) WHERE deleted_at IS NULL;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext NOT NULL,
  full_name   text,
  role        user_role NOT NULL DEFAULT 'student',
  room_id     uuid REFERENCES rooms(id),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  -- ห้ามมี password_hash (passwordless เท่านั้น)
  CONSTRAINT ck_users_email_domain CHECK (email LIKE '%@kmitl.ac.th')
);
-- partial unique: ลบแบบ soft แล้วต้องสร้างบัญชีอีเมลเดิมใหม่ได้
CREATE UNIQUE INDEX uq_users_email ON users(email) WHERE deleted_at IS NULL;

CREATE TABLE login_codes (
  id           bigserial PRIMARY KEY,
  email        citext NOT NULL,
  -- HMAC(secret, code) — sha256 เปล่า ๆ ของ 6 หลัก brute-force offline ได้ทันที
  code_hash    text   NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  -- ต้องมีคอลัมน์นี้ ไม่งั้นนับ rate limit ต่อ IP ใน DB ไม่ได้
  requested_ip inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_codes_email ON login_codes(email, created_at DESC);
CREATE INDEX idx_login_codes_ip    ON login_codes(requested_ip, created_at DESC);

CREATE TABLE assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code    text NOT NULL,
  name          text NOT NULL,
  category      text NOT NULL,             -- electrical / plumbing / furniture / ...
  building_id   uuid NOT NULL REFERENCES buildings(id),
  room_id       uuid REFERENCES rooms(id), -- NULL = ส่วนกลาง
  location_note text,                      -- ใช้กับส่วนกลาง เช่น "ลิฟต์ฝั่งตะวันออก"
  qr_token      text NOT NULL,
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX uq_assets_code ON assets(asset_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_assets_qr   ON assets(qr_token)   WHERE deleted_at IS NULL;

CREATE TABLE ticket_counters (
  be_year  int PRIMARY KEY,
  last_no  int NOT NULL
);

CREATE TABLE tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no     text NOT NULL UNIQUE,
  batch_id      uuid NOT NULL,
  asset_id      uuid NOT NULL REFERENCES assets(id),
  scope         ticket_scope NOT NULL,
  room_id       uuid REFERENCES rooms(id),       -- snapshot ตอนแจ้ง ใช้เช็คสิทธิ์
  reporter_id   uuid NOT NULL REFERENCES users(id),
  assigned_to   uuid REFERENCES users(id),
  status        ticket_status   NOT NULL DEFAULT 'open',
  priority      ticket_priority NOT NULL DEFAULT 'normal',
  title         text NOT NULL,
  description   text,
  report_count  int NOT NULL DEFAULT 1,
  reopen_count  int NOT NULL DEFAULT 0,
  -- ห้องพักเป็นพื้นที่ส่วนตัว: ช่างเริ่มงานได้เมื่อผู้แจ้งอนุญาตให้เข้าห้อง หรือมีนัดแล้ว
  permission_to_enter boolean NOT NULL DEFAULT false,
  scheduled_at  timestamptz,
  resolved_at   timestamptz,
  closed_at     timestamptz,
  confirmed_by  uuid REFERENCES users(id),       -- NULL + auto_closed = ระบบปิดให้
  close_reason  close_reason,
  disputed_at   timestamptz,                     -- มีคนกด same-issue หลัง resolved (ส่วนกลาง)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT ck_scope_room CHECK ((scope = 'room') = (room_id IS NOT NULL)),
  CONSTRAINT ck_closed CHECK (status <> 'closed' OR (closed_at IS NOT NULL AND close_reason IS NOT NULL)),
  -- ปิดได้ต้องผ่าน resolved มาก่อน — ยกกฎลง DB ไม่ปล่อยให้โค้ดถือคนเดียว
  CONSTRAINT ck_closed_after_resolved CHECK (closed_at IS NULL OR resolved_at IS NOT NULL),
  -- ขออนุญาตเข้าห้องใช้กับใบห้องพักเท่านั้น ใบส่วนกลางต้องเป็น false เสมอ
  CONSTRAINT ck_permission_scope CHECK (scope = 'room' OR permission_to_enter = false)
);

-- กันแจ้งซ้ำระดับฐานข้อมูล — predicate ต้องตรงกับ OPEN_STATUSES ใน src/domain/status-rules.ts
-- (contract test เทียบสองฝั่ง) closed / rejected / cancelled ไม่อยู่ใน predicate
-- → ครุภัณฑ์ว่างให้แจ้งใหม่ได้ทันที
CREATE UNIQUE INDEX idx_tickets_asset_open ON tickets(asset_id)
  WHERE status IN ('open','assigned','in_progress','pending_parts','resolved')
    AND deleted_at IS NULL;

-- โควตาใบเปิดต่อผู้แจ้ง — predicate ต้องตรงกับ OPEN_STATUSES เหมือนกัน
CREATE INDEX idx_tickets_reporter_open ON tickets(reporter_id)
  WHERE status IN ('open','assigned','in_progress','pending_parts','resolved')
    AND deleted_at IS NULL;

CREATE INDEX idx_tickets_room      ON tickets(room_id)     WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_assignee  ON tickets(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_autoclose ON tickets(resolved_at)
  WHERE status = 'resolved' AND deleted_at IS NULL;

CREATE TABLE ticket_status_logs (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES tickets(id),
  from_status ticket_status,                     -- NULL = สร้างใบ
  to_status   ticket_status NOT NULL,
  actor_id    uuid REFERENCES users(id),         -- NULL = ระบบ
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- ห้ามมีแถว from = to: assign ซ้ำ/เลื่อนนัด/priority ต้องไป ticket_audit_logs
  CONSTRAINT ck_real_transition CHECK (from_status IS DISTINCT FROM to_status)
);
CREATE INDEX idx_status_logs_ticket ON ticket_status_logs(ticket_id, created_at);

CREATE TABLE ticket_audit_logs (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES tickets(id),
  action      audit_action NOT NULL,
  actor_id    uuid REFERENCES users(id),
  detail      jsonb NOT NULL DEFAULT '{}',       -- {from:..., to:...}
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_ticket ON ticket_audit_logs(ticket_id, created_at);

CREATE TABLE ticket_reporters (
  ticket_id   uuid NOT NULL REFERENCES tickets(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)               -- 1 คนนับได้ครั้งเดียว กัน report_count เฟ้อ
);

CREATE TABLE ticket_comments (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES tickets(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX idx_comments_ticket ON ticket_comments(ticket_id, created_at) WHERE deleted_at IS NULL;

-- schema นี้มี updated_at อยู่ที่ tickets ตารางเดียว จึงลง trigger แค่ตัวนั้น
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tickets_updated
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- เวลาที่ค้างในแต่ละขั้น: ใช้ LEAD หาเวลาออกจากขั้น
-- COALESCE(..., now()) ทำให้แถวสุดท้ายของใบที่จบแล้วโตขึ้นทุกวินาที
-- รายงานต้องกรอง stage NOT IN ('closed','rejected','cancelled') ทิ้งเสมอ
CREATE VIEW v_ticket_stage_durations AS
SELECT l.ticket_id,
       l.to_status                                               AS stage,
       l.created_at                                              AS entered_at,
       LEAD(l.created_at) OVER w                                 AS left_at,
       COALESCE(LEAD(l.created_at) OVER w, now()) - l.created_at AS duration
FROM ticket_status_logs l
JOIN tickets t ON t.id = l.ticket_id AND t.deleted_at IS NULL   -- ห้ามลืม soft delete
WINDOW w AS (PARTITION BY l.ticket_id ORDER BY l.created_at, l.id);
