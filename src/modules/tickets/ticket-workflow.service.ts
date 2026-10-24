import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { InvalidTransition, NoteRequired } from '../../common/errors/domain-errors';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { Ticket, TicketAuditLog, TicketStatusLog, User } from '../../database/entities';
import { Env } from '../../config/env';
import { TicketStatus, UserRole } from '../../domain/enums';
import {
  actorOf,
  ASSIGNABLE_STATUSES,
  canEnterRoom,
  canGoVia,
  Endpoint,
  isOpenStatus,
  NOTE_REQUIRED,
  SCHEDULABLE_STATUSES,
  VIA_ACTION,
} from '../../domain/status-rules';
import { MailService } from '../auth/mail.service';
import { TicketPolicy } from './ticket-policy.service';
import { TicketViewService } from './ticket-view.service';
import {
  AssignTicketDto,
  ChangeStatusDto,
  RejectTicketDto,
  ReopenTicketDto,
  ScheduleTicketDto,
  SetPriorityDto,
  TicketView,
} from './tickets.dto';

// ทุก endpoint ที่แตะสถานะอยู่ในไฟล์นี้ และต้องผ่าน transition() ตัวเดียวกัน (DESIGN 6.2, 6.9)
// ESLint ของไฟล์นี้ห้ามแตะ this.*Repo — ในทรานแซกชันใช้ manager.getRepository() เท่านั้น
// (repository ที่ inject มาใช้ connection หลัก คำสั่งจะหลุดออกนอกทรานแซกชันโดยไม่มี error)
@Injectable()
export class TicketWorkflowService {
  private readonly logger = new Logger(TicketWorkflowService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: TicketPolicy,
    private readonly views: TicketViewService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // --- endpoint ---

  async assign(user: User, ticketId: string, dto: AssignTicketDto): Promise<TicketView> {
    return this.dataSource.transaction(async (m) => {
      // ลำดับ lock ตายตัว: users ก่อน tickets (ลำดับเดียวกับโควตาใน 6.3 กัน deadlock)
      // FOR SHARE ชนกับ FOR UPDATE ที่ UsersService ใช้ตอนระงับ/ลบช่าง → มอบงานกับระงับช่างที่เกิดพร้อมกันผ่านทั้งคู่ไม่ได้
      const technician = await this.lockTechnician(m, dto.technician_id);
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/assign');

      // ใบ resolved ต้องไปทาง /reopen เท่านั้น — ที่นี่เป็นด่านของ ASSIGNABLE_STATUSES ซึ่งประกอบจากตารางกฎ
      if (!ASSIGNABLE_STATUSES.includes(ticket.status)) throw new InvalidTransition(ticket.status, 'assigned');
      if (ticket.assignedTo === technician.id) {
        throw conflict('ALREADY_ASSIGNED', 'ใบนี้มอบหมายให้ช่างคนนี้อยู่แล้ว', { technician_id: technician.id });
      }

      const previous = ticket.assignedTo;
      ticket.assignedTo = technician.id;
      if (ticket.status === 'assigned') {
        // ขั้นไม่เปลี่ยน = เปลี่ยนตัวช่างกลางคิว ห้ามเขียน status log (ck_real_transition จะ error ทันที)
        ticket.scheduledAt = null; // นัดของช่างคนเก่าใช้ต่อไม่ได้
        await m.getRepository(Ticket).save(ticket);
      } else {
        await this.transition(m, user, ticket, 'assigned', { via: '/assign' });
      }

      await m.getRepository(TicketAuditLog).insert({
        ticketId: ticket.id,
        action: previous === null ? 'assign' : 'reassign',
        actorId: user.id,
        detail: { from: previous, to: technician.id },
      });
      return this.views.one(user, ticket.id, m);
    });
  }

  async schedule(user: User, ticketId: string, dto: ScheduleTicketDto): Promise<TicketView> {
    return this.dataSource.transaction(async (m) => {
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/schedule');
      if (!SCHEDULABLE_STATUSES.includes(ticket.status)) {
        throw conflict('NOT_SCHEDULABLE', 'นัดเวลาได้เฉพาะใบที่มีช่างรับงานแล้วและยังไม่เสร็จ', {
          status: ticket.status,
        });
      }
      // เทียบกับเวลาตอนประมวลผล ไม่ใช่ตอน validate ที่ DTO — คำขอที่ค้างอยู่ในคิวนานต้องโดนกฎเดียวกัน
      const at = new Date(dto.scheduled_at);
      if (at.getTime() <= Date.now()) {
        throw badRequest('SCHEDULE_IN_PAST', 'เวลานัดต้องเป็นเวลาในอนาคต', { scheduled_at: dto.scheduled_at });
      }

      const previous = ticket.scheduledAt;
      ticket.scheduledAt = at;
      await m.getRepository(Ticket).save(ticket);
      // ไม่ใช่การเปลี่ยนขั้น — ทุกครั้งรวมการเลื่อนนัดลง audit log เพื่อให้ประวัติการนัดครบ (parity 142)
      await m.getRepository(TicketAuditLog).insert({
        ticketId: ticket.id,
        action: 'schedule',
        actorId: user.id,
        detail: { from: previous?.toISOString() ?? null, to: at.toISOString() },
      });
      return this.views.one(user, ticket.id, m);
    });
  }

  async changeStatus(user: User, ticketId: string, dto: ChangeStatusDto): Promise<TicketView> {
    const { view, resolved } = await this.dataSource.transaction(async (m) => {
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/status');
      await this.transition(m, user, ticket, dto.to, {
        via: '/status',
        note: dto.note ?? null,
        guard: (t) => this.assertRoomIsEnterable(t, dto.to),
      });
      return { view: await this.views.one(user, ticket.id, m), resolved: dto.to === 'resolved' };
    });
    // ส่งเมลหลัง commit เท่านั้น — ส่งข้างในแล้ว rollback = ผู้ใช้ได้เมลของเหตุการณ์ที่ไม่เคยเกิด (DESIGN 6.10)
    if (resolved) await this.notifyResolved(view, dto.note ?? null);
    return view;
  }

  async setPriority(user: User, ticketId: string, dto: SetPriorityDto): Promise<TicketView> {
    return this.dataSource.transaction(async (m) => {
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/priority');
      // ใบที่จบแล้วห้ามแก้ความด่วน ไม่งั้นรายงานย้อนหลังเปลี่ยนค่าได้เรื่อย ๆ (parity 167)
      if (!isOpenStatus(ticket.status)) {
        throw conflict('TICKET_NOT_OPEN', 'ใบแจ้งซ่อมนี้ปิดไปแล้ว', { status: ticket.status });
      }
      if (ticket.priority === dto.priority) {
        throw conflict('PRIORITY_UNCHANGED', 'ความด่วนเท่าเดิม', { priority: dto.priority });
      }

      const previous = ticket.priority;
      ticket.priority = dto.priority;
      await m.getRepository(Ticket).save(ticket);
      await m.getRepository(TicketAuditLog).insert({
        ticketId: ticket.id,
        action: 'priority',
        actorId: user.id,
        detail: { from: previous, to: dto.priority },
      });
      return this.views.one(user, ticket.id, m);
    });
  }

  async reject(user: User, ticketId: string, dto: RejectTicketDto): Promise<TicketView> {
    return this.dataSource.transaction(async (m) => {
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/reject');
      await this.transition(m, user, ticket, 'rejected', { via: '/reject', note: dto.note });
      return this.views.one(user, ticket.id, m);
    });
  }

  async confirm(user: User, ticketId: string): Promise<TicketView> {
    return this.dataSource.transaction(async (m) => {
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/confirm');
      await this.transition(m, user, ticket, 'closed', { via: '/confirm' });
      return this.views.one(user, ticket.id, m);
    });
  }

  // "ยังไม่หาย" — กลับไป assigned โดยคงช่างคนเดิม (DESIGN 3.3) · สิทธิ์ชุดเดียวกับ /confirm (ผูกกับห้อง)
  async reopen(user: User, ticketId: string, dto: ReopenTicketDto): Promise<TicketView> {
    const view = await this.dataSource.transaction(async (m) => {
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/reopen');
      await this.transition(m, user, ticket, 'assigned', { via: '/reopen', note: dto.note });
      return this.views.one(user, ticket.id, m);
    });
    // หลัง commit เท่านั้น เหตุผลเดียวกับเมลตอน resolved (DESIGN 6.10)
    await this.notifyReopened(view, dto.note);
    return view;
  }

  async cancel(user: User, ticketId: string): Promise<TicketView> {
    return this.dataSource.transaction(async (m) => {
      const ticket = await this.lockAndAuthorize(m, user, ticketId, '/cancel');
      await this.transition(m, user, ticket, 'cancelled', { via: '/cancel' });
      return this.views.one(user, ticket.id, m);
    });
  }

  // --- ส่วนกลางที่ทุก endpoint ใช้ร่วมกัน ---

  // ชั้น 0 และชั้น 2 ของทุก action (DESIGN 6.2) — ต้องเรียกก่อนแตะข้อมูลใด ๆ เสมอ
  private async lockAndAuthorize(
    m: EntityManager,
    user: User | null,
    ticketId: string,
    via: Endpoint,
  ): Promise<Ticket> {
    // lock แถวก่อนอ่าน: รูมเมทสองคนกด /confirm พร้อมกัน, Staff สองคน /assign พร้อมกัน
    // และช่างกด resolve พร้อมกับ Staff เปลี่ยนตัวช่าง ต้องเข้าคิวกัน ไม่ใช่อ่านภาพเก่าคนละภาพ
    const ticket = await m.getRepository(Ticket).findOne({
      where: { id: ticketId },
      lock: { mode: 'pessimistic_write' },
    });
    // ใบที่ไม่มี ใบที่ถูก soft delete และใบที่มองไม่เห็น ตอบ 404 เหมือนกันหมด
    // (403 จะยืนยันว่าใบ id นี้มีอยู่จริง — กฎข้อ 3 ชั้น 0)
    if (!ticket) throw notFound('ไม่พบใบแจ้งซ่อม');
    if (user !== null && !this.policy.canSee(user, ticket)) throw notFound('ไม่พบใบแจ้งซ่อม');
    this.policy.assertCan(VIA_ACTION[via], user, ticket); // ชั้น 2 → 403
    return ticket;
  }

  // ชั้น 3 → 409 · note → 400 · side effects · save · status log — ทั้งหมดในทรานแซกชันที่เรียกมา
  private async transition(
    m: EntityManager,
    user: User | null,
    ticket: Ticket,
    to: TicketStatus,
    opts: { via: Endpoint; note?: string | null; guard?: (t: Ticket) => void },
  ): Promise<Ticket> {
    const from = ticket.status;
    // ตารางกฎ + เส้นทางที่ผูกกับ endpoint เดียว (TRANSITION_ONLY_VIA) อยู่ใน canGoVia ตัวเดียว
    if (!canGoVia(from, to, opts.via, actorOf(user))) throw new InvalidTransition(from, to);
    // กฎเฉพาะของ endpoint มาหลังชั้น 3: ใบที่เดินทางนี้ไม่ได้ต้องได้ 409 ของตารางกฎก่อน
    opts.guard?.(ticket);
    // note บังคับมาท้ายสุด — ใบที่ไปปลายทางนั้นไม่ได้ ไม่ควรถูกถามหา note ก่อน
    if (NOTE_REQUIRED.has(to) && !opts.note) throw new NoteRequired(to);

    this.applySideEffects(ticket, from, to, user);
    ticket.status = to;
    await m.getRepository(Ticket).save(ticket);
    await m.getRepository(TicketStatusLog).insert({
      ticketId: ticket.id,
      fromStatus: from,
      toStatus: to,
      actorId: user?.id ?? null,
      note: opts.note ?? null,
    });
    return ticket;
  }

  // ตาราง DESIGN 3.6 — ฟิลด์ที่ผูกกับรอบ resolve ปัจจุบันต้องถูกล้างเมื่อรอบนั้นจบ
  // ที่นี่เป็นที่เดียวที่แตะฟิลด์พวกนี้ ห้าม service อื่นตั้งเอง
  private applySideEffects(ticket: Ticket, from: TicketStatus, to: TicketStatus, user: User | null): void {
    const now = new Date();
    // เปลี่ยนตัวช่างกลางงาน: นัดของช่างคนเก่าใช้ต่อไม่ได้
    if (to === 'assigned' && (from === 'in_progress' || from === 'pending_parts')) ticket.scheduledAt = null;
    if (to === 'resolved') {
      ticket.resolvedAt = now;
      // เริ่มรอบยืนยันใหม่: ถ้าไม่ล้าง job ปิดอัตโนมัติจะข้ามใบที่เคยมีคนแย้งไปตลอดกาล
      ticket.disputedAt = null;
    }
    if (to === 'closed') {
      ticket.closedAt = now;
      if (user === null) {
        // ระบบปิดให้: ไม่มีคนยืนยัน — รายงานใช้คู่ confirmed_by = NULL + auto_closed แยกออกจากใบที่คนปิด
        ticket.confirmedBy = null;
        ticket.closeReason = 'auto_closed';
      } else {
        ticket.confirmedBy = user.id;
        ticket.closeReason = actorOf(user) === 'student' ? 'user_confirmed' : 'staff_confirmed';
      }
      // ไม่ล้าง disputed_at โดยเจตนา — รายงานต้องแยกใบที่ Staff ปิดทั้งที่ยังมีคนแย้งได้ (3.6)
    }
    if (from === 'resolved' && to === 'assigned') {
      // reopen: assigned_to ไม่แตะ = กลับไปหาช่างคนเดิม · รอบยืนยันเดิมจบแล้ว ค่าของรอบนั้นต้องไม่ค้าง
      // ถ้า disputed_at ค้าง job จะข้ามใบนี้ตลอดไปแม้ช่างซ่อมรอบใหม่เสร็จแล้ว
      ticket.reopenCount += 1;
      ticket.resolvedAt = null;
      ticket.disputedAt = null;
      ticket.confirmedBy = null;
    }
    // cancelled / rejected ไม่ตั้ง closed_at: ck_closed_after_resolved ห้าม closed_at ในใบที่ไม่เคยผ่าน resolved
    // เวลาที่ใบจบอ่านจาก ticket_status_logs แถวสุดท้าย (DESIGN 3.5, 3.6)
  }

  // ห้องพักเป็นพื้นที่ส่วนตัว: เริ่มงานได้เมื่อผู้แจ้งอนุญาตให้เข้าห้อง หรือมีนัดแล้ว (DESIGN 6.7)
  // เงื่อนไขอยู่ใน canEnterRoom ตัวเดียวกับที่ allowedActions ใช้ซ่อนปุ่ม — ไม่งั้นหน้าจอโชว์ปุ่มที่กดแล้ว 409
  private assertRoomIsEnterable(ticket: Ticket, to: TicketStatus): void {
    if (to !== 'in_progress' || canEnterRoom(ticket)) return;
    throw conflict('APPOINTMENT_REQUIRED', 'ต้องนัดเวลาก่อนเริ่มงานในห้องพัก', { ticket_no: ticket.ticketNo });
  }

  private async lockTechnician(
    m: EntityManager,
    technicianId: string,
  ): Promise<{ id: string; role: UserRole; is_active: boolean }> {
    const rows: { id: string; role: UserRole; is_active: boolean; deleted_at: Date | null }[] = await m.query(
      `SELECT id, role, is_active, deleted_at FROM users WHERE id = $1 FOR SHARE`,
      [technicianId],
    );
    const row = rows.at(0);
    // ไม่พบ / ไม่ใช่ช่าง / ถูกระงับ / ถูกลบ → 400 ทั้งหมด: เป็นความผิดของค่าที่ส่งมา ไม่ใช่สถานะของใบ
    if (!row || row.deleted_at !== null || !row.is_active || row.role !== 'technician') {
      throw badRequest('INVALID_TECHNICIAN', 'มอบหมายได้เฉพาะช่างที่ยังใช้งานอยู่', { technician_id: technicianId });
    }
    return row;
  }

  // อีเมลไม่ใช่ส่วนหนึ่งของกฎทางธุรกิจ: ส่งไม่สำเร็จให้ log แล้วจบ ไม่ rollback ไม่ retry (DESIGN 6.10)
  private async notifyResolved(view: TicketView, note: string | null): Promise<void> {
    try {
      const recipients = await this.resolvedRecipients(view);
      for (const email of recipients) {
        await this.mail.sendTicketResolved(email, {
          ...this.mailSubject(view),
          note,
          autoCloseAt: view.auto_close_at,
          link: this.link(`/app/tickets/${view.id}`),
        });
      }
    } catch (error) {
      this.logger.warn(`ส่งอีเมลแจ้งผลซ่อมของ ${view.ticket_no} ไม่สำเร็จ: ${String(error)}`);
    }
  }

  // ผู้รับ = ช่างเจ้าของงาน + staff ที่ใช้งานอยู่ (DESIGN 6.10) · ลิงก์ของช่างพาไปหน้างานของช่าง
  private async notifyReopened(view: TicketView, note: string): Promise<void> {
    try {
      const rows: { email: string; role: UserRole }[] = await this.dataSource.query(
        `SELECT email, role FROM users
          WHERE (id = $1 OR role = 'staff') AND is_active = true AND deleted_at IS NULL`,
        [view.assigned_to],
      );
      for (const r of rows) {
        await this.mail.sendTicketReopened(r.email, {
          ...this.mailSubject(view),
          note,
          reopenCount: view.reopen_count,
          link: this.link(r.role === 'technician' ? `/app/jobs/${view.id}` : `/app/tickets/${view.id}`),
        });
      }
    } catch (error) {
      this.logger.warn(`ส่งอีเมลแจ้งการส่งกลับของ ${view.ticket_no} ไม่สำเร็จ: ${String(error)}`);
    }
  }

  private mailSubject(view: TicketView): { ticketNo: string; assetName: string; where: string } {
    return {
      ticketNo: view.ticket_no,
      assetName: `${view.asset.name} (${view.asset.asset_code})`,
      where: view.room === null ? `${view.building.name} ส่วนกลาง` : `ห้อง ${view.room.room_no}`,
    };
  }

  private link(path: string): string {
    return `${this.config.get('APP_BASE_URL', { infer: true })}${path}`;
  }

  // ใบห้องพัก → คนที่พักห้องนั้นตอนนี้ (คนเดียวกับที่มีสิทธิ์กด /confirm) · ส่วนกลาง → staff ที่ใช้งานอยู่
  private async resolvedRecipients(view: TicketView): Promise<string[]> {
    const rows: { email: string }[] =
      view.scope === 'room'
        ? await this.dataSource.query(
            `SELECT email FROM users
              WHERE room_id = $1 AND role = 'student' AND is_active = true AND deleted_at IS NULL`,
            [view.room_id],
          )
        : await this.dataSource.query(
            `SELECT email FROM users WHERE role = 'staff' AND is_active = true AND deleted_at IS NULL`,
          );
    return rows.map((r) => r.email);
  }
}
