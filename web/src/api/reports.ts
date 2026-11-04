import { api } from './client';
import type { SlaSummary, StageDuration, TechnicianRow } from './types';

// ช่วงวันตามเวลาไทย (YYYY-MM-DD) — API ตีความวันเป็นเวลาไทยเอง
export interface Period {
  from?: string;
  to?: string;
}

export const slaSummary = (p: Period) => api<SlaSummary>('/reports/sla-summary', { query: { ...p } });
export const stageDurations = (p: Period) => api<StageDuration[]>('/reports/stage-durations', { query: { ...p } });
export const technicianReport = (p: Period) => api<TechnicianRow[]>('/reports/technicians', { query: { ...p } });
