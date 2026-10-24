import type { HistoryEntryView, TicketView, UiAction } from '../api/schema.gen';
import { firstName, formatDuration, formatWhen } from './format';

// ที่เดียวที่แปลงสถานะเป็นข้อความ สี และกลุ่มที่แสดง (UI-PLAN 2 ข้อ 1)
// pages/ ห้ามเทียบ .status เอง (ESLint บังคับ) — ปุ่มมาจาก actions ส่วนข้อความ/สี/กลุ่มมาจากไฟล์นี้
// ข้อความคัดลอกจาก ST / summaryFor ของ docs/ui/mockup.html

export type TicketStatus = TicketView['status'];
export type TicketPriority = TicketView['priority'];

const STATUS: Record<TicketStatus, { label: string; tone: string }> = {
  open: { label: 'รอมอบหมาย', tone: 's-open' },
  assigned: { label: 'มอบหมายแล้ว', tone: 's-assigned' },
  in_progress: { label: 'กำลังซ่อม', tone: 's-progress' },
  pending_parts: { label: 'รออะไหล่', tone: 's-parts' },
  resolved: { label: 'รอยืนยัน', tone: 's-resolved' },
  closed: { label: 'ปิดแล้ว', tone: 's-closed' },
  rejected: { label: 'ไม่รับเรื่อง', tone: 's-muted' },
  cancelled: { label: 'ยกเลิกแล้ว', tone: 's-muted' },
};

const PRIORITY: Record<TicketPriority, { label: string; tone: string }> = {
  urgent: { label: 'ด่วนมาก', tone: 'p-urgent' },
  high: { label: 'สูง', tone: 'p-high' },
  normal: { label: 'ปกติ', tone: 'p-normal' },
  low: { label: 'ต่ำ', tone: 'p-low' },
};

// ใบที่ยังไม่จบ — ใช้แค่จัดกลุ่มและนับตัวเลขบนแท็บ ไม่ได้ใช้ตัดสินว่ากดอะไรได้ (นั่นคือ actions)
// ตรงกับ OPEN_STATUSES ของ backend (src/domain/status-rules.ts)
const OPEN: readonly TicketStatus[] = ['open', 'assigned', 'in_progress', 'pending_parts', 'resolved'];

export const statusLabel = (s: TicketStatus): string => STATUS[s].label;
export const statusTone = (s: TicketStatus): string => STATUS[s].tone;
export const priorityLabel = (p: TicketPriority): string => PRIORITY[p].label;
export const priorityTone = (p: TicketPriority): string => PRIORITY[p].tone;
export const isOpenTicket = (t: { status: TicketStatus }): boolean => OPEN.includes(t.status);

export const can = (t: { actions: readonly UiAction[] } | null | undefined, action: UiAction): boolean =>
  t?.actions.includes(action) ?? false;

// แท็บ "ส่งซ่อมแล้ว" ของนักศึกษา (UI-PLAN 5): รอคุณยืนยัน = มี confirm ใน actions ไม่ใช่ status = resolved
// ใบส่วนกลางที่ resolved นักศึกษายืนยันไม่ได้ จึงอยู่ "กำลังดำเนินการ" ตามที่ API บอก
export type StudentGroup = 'waiting' | 'active' | 'done';
export const studentGroup = (t: Pick<TicketView, 'status' | 'actions'>): StudentGroup =>
  can(t, 'confirm') ? 'waiting' : isOpenTicket(t) ? 'active' : 'done';

const techName = (t: Pick<TicketView, 'assignee'>): string => firstName(t.assignee?.name);

// ประโยคสรุปใต้ชื่อใบ (summaryFor ของต้นแบบ ฝั่งนักศึกษา)
export const studentSummary = (
  t: Pick<TicketView, 'status' | 'actions' | 'assignee' | 'reopen_count' | 'scheduled_at'>,
  parts?: string | null,
): string => {
  const sched = t.scheduled_at ? ` นัด ${formatWhen(t.scheduled_at)}` : '';
  switch (t.status) {
    case 'open':
      return 'รอเจ้าหน้าที่มอบหมายช่าง';
    case 'assigned':
      return (t.reopen_count > 0 ? `ส่งกลับให้ช่าง${techName(t)}แล้ว` : `มอบหมายให้ช่าง${techName(t)}แล้ว`) + sched;
    case 'in_progress':
      return `ช่าง${techName(t)}กำลังซ่อม` + sched;
    case 'pending_parts':
      return parts ? `รออะไหล่: ${parts}` : 'ช่างรออะไหล่อยู่';
    case 'resolved':
      return can(t, 'confirm')
        ? 'ช่างแจ้งว่าซ่อมเสร็จแล้ว ลองใช้งานแล้วยืนยันผล'
        : 'ช่างแจ้งว่าซ่อมเสร็จแล้ว รอยืนยันผล';
    case 'closed':
      return 'ปิดใบแล้ว';
    case 'cancelled':
      return 'ยกเลิกการแจ้งแล้ว';
    case 'rejected':
      return 'เจ้าหน้าที่ไม่รับเรื่อง';
  }
};

// อะไหล่ที่รออยู่ = หมายเหตุของการเข้าขั้น pending_parts ครั้งล่าสุด (API บังคับ note ตอนเข้าขั้นนี้)
export const pendingParts = (history: readonly HistoryEntryView[] | undefined): string | null => {
  const last = [...(history ?? [])].reverse().find((e) => e.kind === 'status' && e.to_status === 'pending_parts');
  return last?.note ?? null;
};

export interface TimelineItem {
  key: string;
  dot: string;
  label: string;
  detail: string | null;
  at: string;
  duration: string | null;
  // ช่วงรออะไหล่ไม่นับเข้าเวลาซ่อม (DESIGN 9) — ต้นแบบขีดฆ่าไว้
  skip: boolean;
}

const stepLabel = (e: HistoryEntryView): string => {
  switch (e.to_status) {
    case 'open':
      return 'แจ้งซ่อม';
    case 'assigned':
      return e.from_status === 'resolved' ? 'ส่งกลับให้ช่าง' : e.from_status === 'open' ? 'มอบหมาย' : 'เปลี่ยนช่าง';
    case 'in_progress':
      return e.from_status === 'pending_parts' ? 'กลับมาซ่อม' : 'เริ่มซ่อม';
    case 'pending_parts':
      return 'รออะไหล่';
    case 'resolved':
      return 'ซ่อมเสร็จ';
    case 'closed':
      return e.actor ? 'ปิดใบ' : 'ระบบปิดให้';
    case 'cancelled':
      return 'ยกเลิกการแจ้ง';
    case 'rejected':
      return 'ไม่รับเรื่อง';
    default:
      return '';
  }
};

// timeline ของนักศึกษา: เฉพาะการเปลี่ยนขั้นจริง + การนัดเวลา (ข้อมูลที่ผู้พักต้องรู้)
// ขั้นสุดท้ายของใบที่ยังไม่จบแสดง "ตอนนี้" แทนเวลาค้าง เพราะยังนับไม่จบ
export const studentTimeline = (
  history: readonly HistoryEntryView[],
  t: Pick<TicketView, 'status'>,
  meId: string | undefined,
): TimelineItem[] => {
  const steps = history.filter((e) => e.kind === 'status');
  const by = (e: HistoryEntryView): string | null =>
    e.actor ? (e.actor.id === meId ? 'โดยคุณ' : e.actor.name ? `โดย${e.actor.name}` : null) : null;
  const items: TimelineItem[] = [];
  history.forEach((e, i) => {
    if (e.kind === 'audit') {
      if (e.action !== 'schedule') return;
      const to = typeof e.detail?.to === 'string' ? e.detail.to : null;
      items.push({
        key: `a${i}`,
        dot: 'd-audit',
        label: 'นัดเวลาเข้าซ่อม',
        detail: to ? formatWhen(to) : null,
        at: formatWhen(e.at),
        duration: null,
        skip: false,
      });
      return;
    }
    const isLast = e === steps[steps.length - 1];
    const status = e.to_status ?? 'open';
    items.push({
      key: `s${i}`,
      dot: `d-${status}`,
      label: stepLabel(e),
      detail: e.note ? (e.to_status === 'assigned' && e.from_status === 'resolved' ? `"${e.note}"` : e.note) : by(e),
      at: formatWhen(e.at),
      duration: isLast
        ? isOpenTicket(t)
          ? 'ตอนนี้'
          : null
        : e.duration_seconds !== undefined
          ? formatDuration(e.duration_seconds)
          : null,
      skip: status === 'pending_parts',
    });
  });
  return items;
};
