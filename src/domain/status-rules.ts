import { TicketStatus, UserRole } from './enums';

// แหล่งความจริงเดียวของการเดินสถานะ — service ห้าม hardcode เงื่อนไขซ้ำ

// ต้องตรงกับ predicate ของ idx_tickets_asset_open และ idx_tickets_reporter_open (มี contract test เทียบ)
// ห้ามใส่ closed / rejected / cancelled: ครุภัณฑ์ที่ใบจบแล้วต้องแจ้งใหม่ได้ทันที
export const OPEN_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'pending_parts',
  'resolved',
] as const satisfies readonly TicketStatus[];

export type Actor = UserRole | 'system';

export const TRANSITIONS: Record<TicketStatus, Partial<Record<TicketStatus, Actor[]>>> = {
  // ผู้แจ้งถอนใบเองได้เฉพาะตอนยังไม่มีใครรับงาน
  open: { assigned: ['staff'], rejected: ['staff'], cancelled: ['student'] },
  assigned: { in_progress: ['technician'], rejected: ['staff'] },
  // assigned ← staff = เปลี่ยนตัวช่างกลางงาน
  in_progress: { pending_parts: ['technician'], resolved: ['technician'], assigned: ['staff'] },
  pending_parts: { in_progress: ['technician'], assigned: ['staff'] },
  // ช่างไม่อยู่ในแถวนี้เลย = ช่างปิดงานเองไม่ได้ (กฎข้อ 2)
  // closed = ยืนยัน / ปิดอัตโนมัติ · assigned = reopen "ยังไม่หาย"
  resolved: { closed: ['student', 'staff', 'system'], assigned: ['student', 'staff'] },
  closed: {},
  rejected: {},
  cancelled: {},
};

// ตรงกับ NOTE_REQUIRED_STATUSES ของเดิม (app/core/enums.py) · reopen บังคับ note ที่ DTO
export const NOTE_REQUIRED: ReadonlySet<TicketStatus> = new Set<TicketStatus>(['rejected', 'pending_parts']);

// ปลายทางที่ต้องไปทาง endpoint เฉพาะ — /status ตอบ 409 ถ้าพยายามไปทางนี้
export const DEDICATED_ENDPOINTS: Partial<Record<TicketStatus, string>> = {
  assigned: '/assign',
  closed: '/confirm',
  rejected: '/reject',
  cancelled: '/cancel',
};

export const ENDPOINTS = [
  '/assign',
  '/status',
  '/reject',
  '/confirm',
  '/reopen',
  '/cancel',
  '/schedule',
  '/priority',
  'system:auto-close',
] as const;
export type Endpoint = (typeof ENDPOINTS)[number];

export type TicketAction =
  'assign' | 'change_status' | 'reject' | 'confirm' | 'reopen' | 'cancel' | 'schedule' | 'set_priority' | 'auto_close';

// สถานะปลายทางเดียวกันมาได้จากหลาย endpoint ที่ใช้สิทธิ์คนละชุด
//   assigned ← /assign (staff) และ /reopen (ผู้พัก/staff)
//   closed   ← /confirm (ผู้พัก/staff) และ job ปิดอัตโนมัติ (system)
// ถ้าเลือก policy จากสถานะปลายทางจะแยกสองกรณีนี้ไม่ออกและพังกฎข้อ 3
// จึง map จาก endpoint ที่ถูกเรียกไปเป็น action ที่เดียวตรงนี้
export const VIA_ACTION: Record<Endpoint, TicketAction> = {
  '/assign': 'assign',
  '/status': 'change_status',
  '/reject': 'reject',
  '/confirm': 'confirm',
  '/reopen': 'reopen',
  '/cancel': 'cancel',
  '/schedule': 'schedule',
  '/priority': 'set_priority',
  'system:auto-close': 'auto_close',
};

export const isOpenStatus = (s: TicketStatus): boolean => (OPEN_STATUSES as readonly TicketStatus[]).includes(s);

export const canTransition = (from: TicketStatus, to: TicketStatus, actor: Actor): boolean =>
  TRANSITIONS[from][to]?.includes(actor) ?? false;
