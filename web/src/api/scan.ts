import { api } from './client';
import type { Scan } from './types';

export const scan = (qrToken: string) => api<Scan>(`/scan/${encodeURIComponent(qrToken)}`);
