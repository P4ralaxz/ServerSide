import { TicketStatus } from './enums';

// เวลาที่ระบบจะปิดใบให้เอง — ไม่เก็บเป็นคอลัมน์ (DESIGN 7.2)
// job ปิดอัตโนมัติ (สัปดาห์ 5) กับ field auto_close_at ที่ส่งให้หน้าจอต้องใช้ฟังก์ชันนี้ตัวเดียวกัน
// ถ้าแยกกันคิด วันหนึ่งหน้าจอจะนับถอยหลังไปคนละเวลากับที่ job ลงมือจริง
export const HOUR_MS = 3_600_000;

export const autoCloseAt = (
  ticket: { status: TicketStatus; resolvedAt: Date | null; disputedAt: Date | null },
  afterHours: number,
): Date | null => {
  // มีคนแย้งว่ายังไม่หาย → job ข้ามใบนี้ ไม่มีกำหนดปิดอัตโนมัติให้นับถอยหลัง (DESIGN 3.4)
  if (ticket.status !== 'resolved' || ticket.resolvedAt === null || ticket.disputedAt !== null) return null;
  return new Date(ticket.resolvedAt.getTime() + afterHours * HOUR_MS);
};
