import { TICKET_STATUSES, TicketScope, TicketStatus, UserRole } from './enums';

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

export const ENDPOINTS = [
  '/assign',
  '/status',
  '/reject',
  '/confirm',
  '/reopen',
  '/cancel',
  '/schedule',
  '/priority',
  '/same-issue',
  'system:auto-close',
] as const;
export type Endpoint = (typeof ENDPOINTS)[number];

export type TicketAction =
  | 'assign'
  | 'change_status'
  | 'reject'
  | 'confirm'
  | 'reopen'
  | 'cancel'
  | 'schedule'
  | 'set_priority'
  | 'same_issue'
  | 'auto_close';

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
  '/same-issue': 'same_issue',
  'system:auto-close': 'auto_close',
};

export type TransitionKey = `${TicketStatus}->${TicketStatus}`;
export const transitionKey = (from: TicketStatus, to: TicketStatus): TransitionKey => `${from}->${to}`;

// เส้นทางที่ผูกกับ endpoint เดียว — คีย์เป็นคู่ from->to ไม่ใช่สถานะปลายทางเดี่ยว
// `assigned` เป็นปลายทางของทั้ง /assign (open → assigned) และ /reopen (resolved → assigned)
// ถ้าคีย์ด้วยปลายทางอย่างเดียว จะกันได้แค่ /status และ Staff ยังกด /assign กับใบ resolved ได้
// = reopen ที่ข้ามสิทธิ์ของ /reopen และไม่ต้องใส่ note (DESIGN 3.1)
export const TRANSITION_ONLY_VIA: Partial<Record<TransitionKey, readonly Endpoint[]>> = {
  'resolved->assigned': ['/reopen'],
  'resolved->closed': ['/confirm', 'system:auto-close'],
  'open->cancelled': ['/cancel'],
  'open->rejected': ['/reject'],
  'assigned->rejected': ['/reject'],
};

// admin ได้ทุกสิทธิ์ของ staff — ยกระดับ role ที่ฟังก์ชันนี้ที่เดียว (DESIGN 4.2)
// ถ้าใส่ 'admin' ทีละแถวใน TRANSITIONS หรือทีละ endpoint วันหนึ่งจะมีแถวที่ลืมใส่
// แล้วกลายเป็นข้อยกเว้นที่ไม่มีใครตั้งใจ
export const actorOf = (user: { role: UserRole } | null): Actor =>
  user === null ? 'system' : user.role === 'admin' ? 'staff' : user.role;

export const isOpenStatus = (s: TicketStatus): boolean => (OPEN_STATUSES as readonly TicketStatus[]).includes(s);

export const canTransition = (from: TicketStatus, to: TicketStatus, actor: Actor): boolean =>
  TRANSITIONS[from][to]?.includes(actor) ?? false;

// ชั้น 3 ทั้งก้อน: ตารางกฎ + เส้นทางที่ผูกกับ endpoint เดียว
export const canGoVia = (from: TicketStatus, to: TicketStatus, via: Endpoint, actor: Actor): boolean => {
  if (!canTransition(from, to, actor)) return false;
  const only = TRANSITION_ONLY_VIA[transitionKey(from, to)];
  return only === undefined || only.includes(via);
};

// ชื่อปุ่มที่ส่งให้หน้าจอ — ไม่ใช่ชุดเดียวกับ TicketAction ของ policy (DESIGN 7.1)
// policy มี 'change_status' ตัวเดียวสำหรับ 4 ปุ่มของช่าง เพราะทั้งสี่ใช้สิทธิ์ชุดเดียวกัน
// แต่หน้าจอต้องรู้ว่า "ตอนนี้" กดปุ่มไหนได้ จึงต้องแตกตามคู่สถานะ
// 'comment' จะเพิ่มเข้ามาพร้อม endpoint comments ในสัปดาห์ 6 — ชื่อปุ่มที่ยังไม่มี endpoint
// ห้ามอยู่ในตารางนี้แม้จะกรองออกทีหลัง เพราะต้องชี้ไป endpoint ปลอมซึ่ง contract test จะยิงจริง
export type UiAction =
  | 'cancel'
  | 'same_issue'
  | 'assign'
  | 'reject'
  | 'priority'
  | 'schedule'
  | 'start'
  | 'pending_parts'
  | 'resume'
  | 'resolve'
  | 'confirm'
  | 'reopen';

// ตารางแปลงที่เดียว: ชื่อปุ่ม → endpoint ที่ต้องยิง (+ ขั้นปัจจุบันที่ปุ่มนั้นโผล่ และสถานะปลายทาง)
// contract test ใช้ตารางนี้ยิง endpoint จากชื่อ action ได้ตรง ๆ โดยไม่เขียนเงื่อนไขซ้ำ
export const UI_ACTION_CALL: Record<
  UiAction,
  { endpoint: Endpoint; from?: readonly TicketStatus[]; to?: TicketStatus }
> = {
  cancel: { endpoint: '/cancel', to: 'cancelled' },
  same_issue: { endpoint: '/same-issue' },
  assign: { endpoint: '/assign', to: 'assigned' },
  reject: { endpoint: '/reject', to: 'rejected' },
  priority: { endpoint: '/priority' },
  schedule: { endpoint: '/schedule' },
  start: { endpoint: '/status', from: ['assigned'], to: 'in_progress' },
  pending_parts: { endpoint: '/status', from: ['in_progress'], to: 'pending_parts' },
  resume: { endpoint: '/status', from: ['pending_parts'], to: 'in_progress' },
  resolve: { endpoint: '/status', from: ['in_progress'], to: 'resolved' },
  confirm: { endpoint: '/confirm', to: 'closed' },
  reopen: { endpoint: '/reopen', to: 'assigned' },
};

export const UI_ACTIONS = Object.keys(UI_ACTION_CALL) as UiAction[];

// ปุ่มที่ endpoint ยังไม่เกิด — ห้ามส่งชื่อปุ่มที่หน้าจอกดแล้ว 404 (ตัดชื่อออกเมื่อ endpoint นั้นมีจริง)
// /reopen ทำสัปดาห์ 5 · 'comment' ยังไม่อยู่ใน UiAction เลยเพราะต้องมี endpoint ก่อน (สัปดาห์ 6)
export const UI_ACTIONS_NOT_IMPLEMENTED: readonly UiAction[] = ['reopen'];

// สถานะที่ action ซึ่ง "ไม่เปลี่ยนขั้น" ทำได้ — endpoint และ allowedActions อ่านตารางเดียวกันนี้
// 'assign' อยู่ด้วยเพราะเปลี่ยนตัวช่างตอนใบเป็น assigned แล้วไม่ใช่การเปลี่ยนขั้น (ck_real_transition จะปฏิเสธ)
export const SAME_STATUS_ALLOWED: Partial<Record<UiAction, readonly TicketStatus[]>> = {
  assign: ['assigned'],
  schedule: ['assigned', 'in_progress', 'pending_parts'],
  priority: OPEN_STATUSES,
  same_issue: OPEN_STATUSES,
};

// ห้องพักเป็นพื้นที่ส่วนตัว: ช่างเข้าไปทำงานได้เมื่อผู้แจ้งอนุญาต หรือมีนัดแล้ว (DESIGN 6.7)
// endpoint /status และ allowedActions ใช้ฟังก์ชันนี้ตัวเดียวกัน — ไม่งั้นหน้าจอจะโชว์ปุ่ม "เริ่มงาน"
// ที่กดแล้วได้ 409 (contract test ของ actions จับกรณีนี้)
export const canEnterRoom = (ticket: {
  scope: TicketScope;
  permissionToEnter: boolean;
  scheduledAt: Date | null;
}): boolean => ticket.scope !== 'room' || ticket.permissionToEnter || ticket.scheduledAt !== null;

// สถานะที่ /assign รับได้ — ประกอบจากตารางกฎ ไม่ใช่รายการที่เขียนมือ
export const ASSIGNABLE_STATUSES: readonly TicketStatus[] = TICKET_STATUSES.filter(
  (s) => canGoVia(s, 'assigned', '/assign', 'staff') || (SAME_STATUS_ALLOWED.assign ?? []).includes(s),
);

export const SCHEDULABLE_STATUSES: readonly TicketStatus[] = SAME_STATUS_ALLOWED.schedule ?? [];
