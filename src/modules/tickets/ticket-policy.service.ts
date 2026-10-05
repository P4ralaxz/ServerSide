import { Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { forbidden } from '../../common/errors/errors';
import { Asset, Ticket, User } from '../../database/entities';
import { TicketAction } from '../../domain/status-rules';

// ชั้น 2 (ownership) ทั้งหมดของใบแจ้งซ่อมอยู่ในไฟล์นี้ไฟล์เดียว — ทั้ง "เห็นได้" และ "แตะได้"
// สองอย่างนี้ต้องแก้คู่กันเสมอ: ถ้าแยกไฟล์ จะมีวันที่แก้ฝั่งหนึ่งแล้วลืมอีกฝั่ง
// ห้ามเพิ่มเงื่อนไข "อาคารเดียวกัน" ให้ใบส่วนกลาง — ส่วนกลางเปิดทุกอาคารโดยเจตนา (กฎข้อ 3)

// ข้อมูลเท่าที่ policy ต้องใช้ — รับได้ทั้ง entity และแถวที่อ่านด้วย SQL ตรง
export type PolicyTicket = Pick<Ticket, 'scope' | 'roomId' | 'reporterId' | 'assignedTo'>;
export type PolicyUser = Pick<User, 'id' | 'role' | 'roomId'>;

const livesIn = (user: PolicyUser, roomId: string | null): boolean =>
  user.role === 'student' && roomId !== null && user.roomId === roomId;

@Injectable()
export class TicketPolicy {
  // ใครเห็นใบไหน (ชั้น 0) — ใช้กับ query ที่ alias ของ tickets เป็น `t`
  visibilityFilter<T extends object>(user: PolicyUser, qb: SelectQueryBuilder<T>): SelectQueryBuilder<T> {
    qb.andWhere('t.deleted_at IS NULL');
    switch (user.role) {
      case 'student':
        // ใบที่ตัวเองแจ้งต้องเห็นเสมอ แม้ย้ายห้องไปแล้ว — ไม่งั้นผู้แจ้งที่ย้ายห้องจะโดน 404 ตอนกด /cancel ใบของตัวเอง
        // "เห็นได้" ≠ "ยืนยันได้": /confirm /reopen ยังผูกกับห้องใน assertCan
        return qb.andWhere(`(t.scope = 'common_area' OR t.room_id = :policyRoomId OR t.reporter_id = :policyUserId)`, {
          policyRoomId: user.roomId,
          policyUserId: user.id,
        });
      case 'technician':
        return qb.andWhere('t.assigned_to = :policyUserId', { policyUserId: user.id });
      case 'staff':
      case 'admin':
        return qb;
    }
  }

  // เงื่อนไขเดียวกับ visibilityFilter สำหรับใบที่โหลดมาแล้ว (เช่น หลัง lock แถว) — มีเทสเทียบสองฝั่งให้ตรงกัน
  canSee(user: PolicyUser, ticket: PolicyTicket): boolean {
    switch (user.role) {
      case 'student':
        return (
          ticket.scope === 'common_area' ||
          (user.roomId !== null && ticket.roomId === user.roomId) ||
          ticket.reporterId === user.id
        );
      case 'technician':
        return ticket.assignedTo === user.id;
      case 'staff':
      case 'admin':
        return true;
    }
  }

  // user = null คือระบบ (job ปิดอัตโนมัติ)
  can(action: TicketAction, user: PolicyUser | null, ticket: PolicyTicket): boolean {
    if (user === null) return action === 'auto_close';
    const isRoom = ticket.scope === 'room';

    switch (action) {
      case 'same_issue':
        // ส่วนกลาง: นักศึกษาทุกคนทุกอาคาร · ห้องพัก: เฉพาะคนที่พักห้องนั้นตอนนี้
        return user.role === 'student' && (!isRoom || livesIn(user, ticket.roomId));
      case 'confirm':
      case 'reopen':
        // ผูกกับห้อง ไม่ใช่กับคนแจ้ง: ห้องพัก → คนที่พักห้องนั้น (Staff ทำแทนไม่ได้) · ส่วนกลาง → Staff
        return isRoom ? livesIn(user, ticket.roomId) : user.role === 'staff';
      case 'cancel':
        // ถอนคำแจ้งของตัวเอง — สิทธิ์ของผู้แจ้ง ไม่ใช่สิทธิ์ของห้อง
        return user.role === 'student' && ticket.reporterId === user.id;
      case 'change_status':
        return user.role === 'technician' && ticket.assignedTo === user.id;
      case 'schedule':
        return user.role === 'staff' || (user.role === 'technician' && ticket.assignedTo === user.id);
      case 'assign':
      case 'reject':
        return user.role === 'staff';
      case 'set_priority':
        return user.role === 'staff' || user.role === 'admin';
      case 'auto_close':
        return false;
    }
  }

  assertCan(action: TicketAction, user: PolicyUser | null, ticket: PolicyTicket): void {
    if (!this.can(action, user, ticket)) throw forbidden();
  }

  // ใช้ตอนสร้างใบ — ต้องเรียกก่อนเช็คแจ้งซ้ำเสมอ
  // ถ้าสลับลำดับ นักศึกษาห้อง A ยิง asset ของห้อง B จะได้ 409 พร้อม ticket_no ของห้อง B = รู้ว่าห้องอื่นแจ้งซ่อมอะไร
  canReport(user: PolicyUser, asset: Pick<Asset, 'roomId'>): boolean {
    if (user.role !== 'student' && user.role !== 'staff') return false;
    // ห้องพักล็อกทุก role รวม Staff: ใบห้องพักต้องมีคนในห้องที่ยืนยันปิดงานได้
    return asset.roomId === null || livesIn(user, asset.roomId);
  }

  assertCanReport(user: PolicyUser, asset: Pick<Asset, 'roomId'>): void {
    if (!this.canReport(user, asset)) throw forbidden('แจ้งซ่อมได้เฉพาะครุภัณฑ์ในห้องของตัวเองหรือส่วนกลาง');
  }
}
