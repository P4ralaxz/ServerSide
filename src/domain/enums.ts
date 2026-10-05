// ค่าทุกตัวต้องตรงกับ ENUM ใน 001_init.sql — contract test (test/contract/schema-vs-code.spec.ts) เทียบสองฝั่ง
// เขียนเป็น array แบบ const เพราะ contract test ต้องวนค่าได้ตอนรัน (type อย่างเดียวหายไปหลัง compile)

export const USER_ROLES = ['student', 'technician', 'staff', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TICKET_SCOPES = ['room', 'common_area'] as const;
export type TicketScope = (typeof TICKET_SCOPES)[number];

export const TICKET_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'pending_parts',
  'resolved',
  'closed',
  'rejected',
  'cancelled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const CLOSE_REASONS = ['user_confirmed', 'staff_confirmed', 'auto_closed'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const AUDIT_ACTIONS = [
  'assign',
  'reassign',
  'schedule',
  'priority',
  'auto_escalate',
  'same_issue',
  'reopen',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
