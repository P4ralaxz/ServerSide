import { api } from './client';
import type { User } from './types';

// ช่างที่มอบงานให้ได้ — API ตรวจซ้ำตอน /assign อยู่แล้ว (INVALID_TECHNICIAN) รายการนี้มีไว้ให้เลือกเท่านั้น
export const listTechnicians = () => api<User[]>('/users', { query: { role: 'technician', is_active: true } });
