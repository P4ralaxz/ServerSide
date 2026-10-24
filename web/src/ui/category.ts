import type { IconName } from './icons';

// หมวดของครุภัณฑ์ (assets.category) → ชื่อภาษาไทยและไอคอนในรายการ
// หมวดที่ไม่รู้จักยังแสดงได้ด้วยชื่อเดิมและไอคอนประแจ — เพิ่มหมวดใหม่ที่ API ได้โดยหน้าเว็บไม่พัง
const CATEGORY: Record<string, { label: string; icon: IconName }> = {
  electrical: { label: 'ไฟฟ้า', icon: 'bolt' },
  plumbing: { label: 'ประปา', icon: 'drop' },
  door_window: { label: 'ประตู หน้าต่าง', icon: 'door' },
  structure: { label: 'โครงสร้าง', icon: 'home' },
  furniture: { label: 'เฟอร์นิเจอร์', icon: 'home' },
  elevator: { label: 'ลิฟต์', icon: 'box' },
  appliance: { label: 'เครื่องใช้ไฟฟ้า', icon: 'box' },
};

export const categoryLabel = (c: string): string => CATEGORY[c]?.label ?? c;
export const categoryIcon = (c: string): IconName => CATEGORY[c]?.icon ?? 'wrench';
