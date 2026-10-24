import { api } from './client';
import type { Asset, AssetItem, Room } from './types';

export const getAsset = (id: string) => api<Asset>(`/assets/${id}`);
export const listAssets = (query: { room_id?: string; building_id?: string; common_area?: boolean }) =>
  api<AssetItem[]>('/assets', { query });
export const getRoom = (id: string) => api<Room>(`/rooms/${id}`);
