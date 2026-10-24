import { TicketPriority, TicketStatus } from './enums';

// เป้าชั่วโมงต่อ priority (ของเดิม settings.SLA_HOURS)
// เป็นค่าคงที่ ไม่ใช่คอลัมน์ sla_due_at: priority เปลี่ยนได้ตลอดและช่วง pending_parts ต้องหยุดนับ
// ค่าที่เก็บไว้จะผิดทันทีที่มีการเปลี่ยน จึงคิดจาก log ตอนออกรายงานแทน
export const SLA_TARGET_HOURS: Record<TicketPriority, number> = { urgent: 4, high: 24, normal: 72, low: 168 };

// ขั้นที่นับเป็น "เวลาซ่อม" (DESIGN 9) = ผลรวมเวลาที่ใบอยู่ในขั้นเหล่านี้ก่อน resolve ครั้งล่าสุด
//   ไม่นับ pending_parts — รออะไหล่ไม่ใช่เวลาที่หอหรือช่างทำอะไรได้
//   ไม่นับ resolved — ช่วงรอยืนยันเป็นเวลาของผู้ใช้ (SLA จบที่ resolved ไม่ใช่ closed)
//   ใบที่ถูก reopen: ช่วงรอยืนยันรอบก่อนก็ไม่นับด้วยเหตุผลเดียวกัน
export const SLA_COUNTED_STAGES: readonly TicketStatus[] = ['open', 'assigned', 'in_progress'];
