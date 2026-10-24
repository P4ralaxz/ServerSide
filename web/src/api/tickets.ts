import { api } from './client';
import type { CreateTicketsResponse, HistoryEntry, Ticket } from './types';

export interface NewItem {
  asset_id: string;
  title: string;
  description: string;
  permission_to_enter?: boolean;
}

export const getTicket = (id: string) => api<Ticket>(`/tickets/${id}`);
export const getHistory = (id: string) => api<HistoryEntry[]>(`/tickets/${id}/history`);
export const listTickets = (query: { room_id?: string; mine?: boolean; limit?: number }) =>
  api<Ticket[]>('/tickets', { query });

export const createTickets = (items: NewItem[]) =>
  api<CreateTicketsResponse>('/tickets', { method: 'POST', body: { items } });

export const confirmTicket = (id: string) => api<Ticket>(`/tickets/${id}/confirm`, { method: 'POST' });
export const reopenTicket = (id: string, note: string) =>
  api<Ticket>(`/tickets/${id}/reopen`, { method: 'POST', body: { note } });
export const cancelTicket = (id: string) => api<Ticket>(`/tickets/${id}/cancel`, { method: 'POST' });
export const sameIssue = (id: string) => api<Ticket>(`/tickets/${id}/same-issue`, { method: 'POST' });
