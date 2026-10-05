import { TicketPriority } from './enums';

// เป้าชั่วโมงต่อ priority (ของเดิม settings.SLA_HOURS)
// เป็นค่าคงที่ ไม่ใช่คอลัมน์ sla_due_at: priority เปลี่ยนได้ตลอดและช่วง pending_parts ต้องหยุดนับ
// ค่าที่เก็บไว้จะผิดทันทีที่มีการเปลี่ยน จึงคิดจาก log ตอนออกรายงานแทน
export const SLA_TARGET_HOURS: Record<TicketPriority, number> = { urgent: 4, high: 24, normal: 72, low: 168 };
