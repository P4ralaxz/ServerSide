import { api } from './client';
import type { CreateUserDto, UpdateUserDto } from './schema.gen';
import type { User } from './types';

// ช่างที่มอบงานให้ได้ — API ตรวจซ้ำตอน /assign อยู่แล้ว (INVALID_TECHNICIAN) รายการนี้มีไว้ให้เลือกเท่านั้น
export const listTechnicians = () => api<User[]>('/users', { query: { role: 'technician', is_active: true } });

// ทุกบัญชี — หน้าผู้ใช้กรองเองบนเครื่อง และนับคนในห้องจากรายการเดียวกันนี้
export const listUsers = () => api<User[]>('/users');
export const createUser = (body: CreateUserDto) => api<User>('/users', { method: 'POST', body });
export const updateUser = (id: string, body: UpdateUserDto) => api<User>(`/users/${id}`, { method: 'PATCH', body });
