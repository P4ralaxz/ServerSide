import { api } from './client';
import type { Comment, CreateTicketsResponse, HistoryEntry, QueueCounts, Ticket } from './types';

export interface NewItem {
  asset_id: string;
  title: string;
  description: string;
  permission_to_enter?: boolean;
}

export type TicketQuery = {
  status?: readonly Ticket['status'][];
  scope?: Ticket['scope'];
  priority?: Ticket['priority'];
  room_id?: string;
  mine?: boolean;
  disputed?: boolean;
  reopened?: boolean;
  limit?: number;
};

export const getTicket = (id: string) => api<Ticket>(`/tickets/${id}`);
export const getHistory = (id: string) => api<HistoryEntry[]>(`/tickets/${id}/history`);
// ความเห็นในใบ — ทุกบทบาท · นักศึกษาไม่ได้รับความเห็นภายใน และส่ง is_internal ไม่ได้ (API ตอบ 403)
export const listComments = (id: string) => api<Comment[]>(`/tickets/${id}/comments`);
export const addComment = (id: string, body: string, isInternal: boolean) =>
  api<Comment>(`/tickets/${id}/comments`, { method: 'POST', body: { body, is_internal: isInternal } });
export const listTickets = (query: TicketQuery) => api<Ticket[]>('/tickets', { query });
export const queueCounts = () => api<QueueCounts>('/tickets/queue-counts');

export const createTickets = (items: NewItem[]) =>
  api<CreateTicketsResponse>('/tickets', { method: 'POST', body: { items } });

// นักศึกษา / Staff (ใบส่วนกลาง)
export const confirmTicket = (id: string) => api<Ticket>(`/tickets/${id}/confirm`, { method: 'POST' });
export const reopenTicket = (id: string, note: string) =>
  api<Ticket>(`/tickets/${id}/reopen`, { method: 'POST', body: { note } });
export const cancelTicket = (id: string) => api<Ticket>(`/tickets/${id}/cancel`, { method: 'POST' });
export const sameIssue = (id: string) => api<Ticket>(`/tickets/${id}/same-issue`, { method: 'POST' });

// ช่าง — ปุ่มทั้งสี่ยิง /status ตัวเดียวกัน (UI_ACTION_CALL ฝั่ง backend)
export const changeStatus = (id: string, to: Ticket['status'], note?: string) =>
  api<Ticket>(`/tickets/${id}/status`, { method: 'POST', body: note ? { to, note } : { to } });
export const scheduleTicket = (id: string, scheduledAt: string) =>
  api<Ticket>(`/tickets/${id}/schedule`, { method: 'PATCH', body: { scheduled_at: scheduledAt } });

// Staff
export const assignTicket = (id: string, technicianId: string) =>
  api<Ticket>(`/tickets/${id}/assign`, { method: 'POST', body: { technician_id: technicianId } });
export const rejectTicket = (id: string, note: string) =>
  api<Ticket>(`/tickets/${id}/reject`, { method: 'POST', body: { note } });
export const setPriority = (id: string, priority: Ticket['priority']) =>
  api<Ticket>(`/tickets/${id}/priority`, { method: 'PATCH', body: { priority } });
