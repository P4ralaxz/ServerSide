import { api, apiBlob } from './client';
import type { BuildingView } from './schema.gen';
import type { Asset, AssetItem, Room } from './types';

export const getAsset = (id: string) => api<Asset>(`/assets/${id}`);
export const listAssets = (query: { room_id?: string; building_id?: string; common_area?: boolean }) =>
  api<AssetItem[]>('/assets', { query });
// รูป QR ของครุภัณฑ์ (staff, admin) — ลิงก์ในรูปชี้ไปหน้าสแกนตาม APP_BASE_URL ของเซิร์ฟเวอร์
export const qrImage = (id: string) => apiBlob(`/assets/${id}/qr`);
export const getRoom = (id: string) => api<Room>(`/rooms/${id}`);
export const listRooms = () => api<Room[]>('/rooms');
export const listBuildings = () => api<BuildingView[]>('/buildings');
