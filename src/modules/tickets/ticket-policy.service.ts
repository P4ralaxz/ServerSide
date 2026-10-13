import { Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { forbidden } from '../../common/errors/errors';
import { Asset, Ticket, User } from '../../database/entities';
import {
  actorOf,
  canEnterRoom,
  canGoVia,
  SAME_STATUS_ALLOWED,
  TicketAction,
  UI_ACTION_CALL,
  UI_ACTIONS,
  UI_ACTIONS_NOT_IMPLEMENTED,
  UiAction,
  VIA_ACTION,
} from '../../domain/status-rules';

// ชั้น 2 (ownership) ทั้งหมดของใบแจ้งซ่อมอยู่ในไฟล์นี้ไฟล์เดียว — ทั้ง "เห็นได้" และ "แตะได้"
// สองอย่างนี้ต้องแก้คู่กันเสมอ: ถ้าแยกไฟล์ จะมีวันที่แก้ฝั่งหนึ่งแล้วลืมอีกฝั่ง
// ห้ามเพิ่มเงื่อนไข "อาคารเดียวกัน" ให้ใบส่วนกลาง — ส่วนกลางเปิดทุกอาคารโดยเจตนา (กฎข้อ 3)

// ข้อมูลเท่าที่ policy ต้องใช้ — รับได้ทั้ง entity และแถวที่อ่านด้วย SQL ตรง
export type PolicyTicket = Pick<
  Ticket,
  'scope' | 'roomId' | 'reporterId' | 'assignedTo' | 'status' | 'permissionToEnter' | 'scheduledAt'
>;
export type PolicyUser = Pick<User, 'id' | 'role' | 'roomId'>;

// ข้อมูลของ "ผู้ใช้คนนี้กับใบนี้" ที่อยู่ในตารางอื่น — ผู้เรียกต้องอ่านมาเป็นชุด (ห้าม query ต่อแถว)
export interface ActionContext {
  alreadyReported?: boolean;
}

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
  // ทุกที่ที่เทียบ "เป็น staff ไหม" ใช้ actorOf() ไม่ใช่ user.role ดิบ — admin จึงได้สิทธิ์ของ staff
  // โดยไม่ต้องเขียน 'admin' ซ้ำทุกแถว (DESIGN 4.2) · 'student' ไม่ถูกยกระดับ จึงกัน admin ออกจาก confirm ใบห้องพัก
  can(action: TicketAction, user: PolicyUser | null, ticket: PolicyTicket): boolean {
    if (user === null) return action === 'auto_close';
    const isRoom = ticket.scope === 'room';
    const actor = actorOf(user);

    switch (action) {
      case 'same_issue':
        // ส่วนกลาง: นักศึกษาทุกคนทุกอาคาร · ห้องพัก: เฉพาะคนที่พักห้องนั้นตอนนี้
        return actor === 'student' && (!isRoom || livesIn(user, ticket.roomId));
      case 'confirm':
      case 'reopen':
        // ผูกกับห้อง ไม่ใช่กับคนแจ้ง: ห้องพัก → คนที่พักห้องนั้น (Staff/admin ทำแทนไม่ได้) · ส่วนกลาง → Staff
        return isRoom ? livesIn(user, ticket.roomId) : actor === 'staff';
      case 'cancel':
        // ถอนคำแจ้งของตัวเอง — สิทธิ์ของผู้แจ้ง ไม่ใช่สิทธิ์ของห้อง
        return actor === 'student' && ticket.reporterId === user.id;
      case 'change_status':
        return actor === 'technician' && ticket.assignedTo === user.id;
      case 'schedule':
        return actor === 'staff' || (actor === 'technician' && ticket.assignedTo === user.id);
      case 'assign':
      case 'reject':
      case 'set_priority':
        return actor === 'staff';
      case 'auto_close':
        return false;
    }
  }

  // ปุ่มที่ผู้ใช้คนนี้กดกับใบนี้ได้ "ตอนนี้" (DESIGN 7.1)
  // ต้องประกอบจากฟังก์ชันเดียวกับที่ endpoint ใช้ทั้งสามชั้น ห้ามมีเงื่อนไขชุดใหม่ที่นี่
  // ไม่ query อะไรเพิ่ม — เรียกต่อแถวของ GET /tickets ได้โดยไม่เกิด N+1
  allowedActions(user: PolicyUser, ticket: PolicyTicket, ctx: ActionContext = {}): UiAction[] {
    const actor = actorOf(user);
    return UI_ACTIONS.filter((a) => {
      // ปุ่มที่ endpoint ยังไม่เกิด ห้ามส่งออกไป ไม่งั้นหน้าจอมีปุ่มที่กดแล้ว 404
      if (UI_ACTIONS_NOT_IMPLEMENTED.includes(a)) return false;
      // กดเจอปัญหาเดียวกันได้คนละครั้ง — คนที่กดแล้ว (รวมผู้แจ้งเอง) กดอีกได้ 409 ปุ่มจึงต้องหาย
      if (a === 'same_issue' && ctx.alreadyReported === true) return false;
      const call = UI_ACTION_CALL[a];
      if (!this.can(VIA_ACTION[call.endpoint], user, ticket)) return false; // ชั้น 2
      // ปุ่มของช่างสี่ตัวยิง /status ตัวเดียวกัน แยกจากกันด้วยขั้นปัจจุบัน
      if (call.from && !call.from.includes(ticket.status)) return false;
      // ใบห้องพักที่เข้าไม่ได้ ยังไม่มีปุ่มเริ่มงาน/ซ่อมต่อ (ต้องนัดก่อน — DESIGN 6.7)
      if (call.to === 'in_progress' && !canEnterRoom(ticket)) return false;
      // ชั้น 3: เป็นการเปลี่ยนขั้นที่ตารางกฎยอม หรือเป็น action ที่ขั้นไม่เปลี่ยน (assign ซ้ำ/นัด/priority)
      const asTransition = call.to !== undefined && canGoVia(ticket.status, call.to, call.endpoint, actor);
      const asSameStatus = (SAME_STATUS_ALLOWED[a] ?? []).includes(ticket.status);
      return asTransition || asSameStatus;
    });
  }

  assertCan(action: TicketAction, user: PolicyUser | null, ticket: PolicyTicket): void {
    if (!this.can(action, user, ticket)) throw forbidden();
  }

  // ใช้ตอนสร้างใบ — ต้องเรียกก่อนเช็คแจ้งซ้ำเสมอ
  // ถ้าสลับลำดับ นักศึกษาห้อง A ยิง asset ของห้อง B จะได้ 409 พร้อม ticket_no ของห้อง B = รู้ว่าห้องอื่นแจ้งซ่อมอะไร
  canReport(user: PolicyUser, asset: Pick<Asset, 'roomId'>): boolean {
    const actor = actorOf(user);
    // admin ⊇ staff: admin แจ้งใบส่วนกลางได้เหมือน staff (DESIGN 6.3 ยกเว้นโควตาให้ทั้งคู่อยู่แล้ว)
    if (actor !== 'student' && actor !== 'staff') return false;
    // ห้องพักล็อกทุก role รวม Staff: ใบห้องพักต้องมีคนในห้องที่ยืนยันปิดงานได้
    return asset.roomId === null || livesIn(user, asset.roomId);
  }

  assertCanReport(user: PolicyUser, asset: Pick<Asset, 'roomId'>): void {
    if (!this.canReport(user, asset)) throw forbidden('แจ้งซ่อมได้เฉพาะครุภัณฑ์ในห้องของตัวเองหรือส่วนกลาง');
  }
}
