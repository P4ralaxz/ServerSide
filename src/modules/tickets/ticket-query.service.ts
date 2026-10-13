import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notFound } from '../../common/errors/errors';
import { Ticket, TicketAuditLog, TicketStatusLog, User } from '../../database/entities';
import { TICKET_LIST_DEFAULT_LIMIT } from '../../domain/limits';
import { TicketPolicy } from './ticket-policy.service';
import { TicketViewService } from './ticket-view.service';
import { HistoryEntryView, ListTicketsQuery, TicketView, UserRefView } from './tickets.dto';

@Injectable()
export class TicketQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: TicketPolicy,
    private readonly views: TicketViewService,
  ) {}

  async list(user: User, q: ListTicketsQuery): Promise<TicketView[]> {
    // ตัวกรองจากผู้ใช้ซ้อนบน visibilityFilter เสมอ — กรองยังไงก็ไม่มีทางได้ใบที่ตัวเองมองไม่เห็น
    const qb = this.policy.visibilityFilter(user, this.dataSource.getRepository(Ticket).createQueryBuilder('t'));

    if (q.status?.length) qb.andWhere('t.status IN (:...status)', { status: q.status });
    if (q.scope) qb.andWhere('t.scope = :scope', { scope: q.scope });
    if (q.room_id) qb.andWhere('t.room_id = :roomId', { roomId: q.room_id });
    if (q.asset_id) qb.andWhere('t.asset_id = :assetId', { assetId: q.asset_id });
    if (q.batch_id) qb.andWhere('t.batch_id = :batchId', { batchId: q.batch_id });
    if (q.mine) qb.andWhere('t.reporter_id = :me', { me: user.id });
    // tickets ไม่มี building ของตัวเอง — อาคารคืออาคารของครุภัณฑ์
    if (q.building_id) {
      qb.andWhere('t.asset_id IN (SELECT a.id FROM assets a WHERE a.building_id = :buildingId)', {
        buildingId: q.building_id,
      });
    }

    const tickets = await qb
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.ticket_no', 'DESC')
      .take(q.limit ?? TICKET_LIST_DEFAULT_LIMIT)
      .skip(q.offset ?? 0)
      .getMany();

    // join ทั้งหมดทำเป็นชุดใน TicketViewService — จำนวน query ไม่ขึ้นกับจำนวนใบในหน้านี้
    return this.views.of(user, tickets);
  }

  async detail(user: User, id: string): Promise<TicketView> {
    const ticket = await this.loadVisible(user, id);
    return this.views.one(user, ticket.id);
  }

  // ประวัติรวมสองตาราง (DESIGN 7.3): status log = การเปลี่ยนขั้นจริง · audit log = สิ่งที่ขั้นไม่เปลี่ยน
  async history(user: User, id: string): Promise<HistoryEntryView[]> {
    const ticket = await this.loadVisible(user, id);

    const statusLogs = await this.dataSource
      .getRepository(TicketStatusLog)
      .find({ where: { ticketId: ticket.id }, order: { createdAt: 'ASC', id: 'ASC' } });
    const auditLogs = await this.dataSource
      .getRepository(TicketAuditLog)
      .find({ where: { ticketId: ticket.id }, order: { createdAt: 'ASC', id: 'ASC' } });

    const actors = await this.actorsOf([...statusLogs.map((l) => l.actorId), ...auditLogs.map((l) => l.actorId)]);

    const now = Date.now();
    const statusEntries: HistoryEntryView[] = statusLogs.map((log, idx) => ({
      kind: 'status',
      at: log.createdAt,
      actor: this.actorRef(log.actorId, actors),
      from_status: log.fromStatus,
      to_status: log.toStatus,
      note: log.note,
      // ขั้นสุดท้ายยังเดินอยู่ → นับถึงตอนนี้ (ต้นแบบแสดงคำว่า "ตอนนี้" ที่บรรทัดล่างสุด)
      duration_seconds: Math.max(
        0,
        Math.round(((statusLogs[idx + 1]?.createdAt.getTime() ?? now) - log.createdAt.getTime()) / 1000),
      ),
    }));

    const auditEntries: HistoryEntryView[] = auditLogs.map((log) => ({
      kind: 'audit',
      at: log.createdAt,
      actor: this.actorRef(log.actorId, actors),
      action: log.action,
      detail: log.detail,
    }));

    return [...statusEntries, ...auditEntries].sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private async loadVisible(user: User, id: string): Promise<Ticket> {
    const ticket = await this.policy
      .visibilityFilter(user, this.dataSource.getRepository(Ticket).createQueryBuilder('t'))
      .andWhere('t.id = :id', { id })
      .getOne();
    // มองไม่เห็น = ไม่พบ: ตอบ 404 เหมือนกันทั้งสองกรณี ไม่บอกว่าใบ id นี้มีอยู่จริงหรือไม่
    if (!ticket) throw notFound('ไม่พบใบแจ้งซ่อม');
    return ticket;
  }

  // ชื่อคนกดของทุกบรรทัดในคำสั่งเดียว — ต้นแบบแสดงชื่อ ไม่ใช่ uuid (DESIGN 7.3)
  // รวมคนที่ถูก soft delete ไปแล้วด้วย: ประวัติของใบเก่าต้องยังบอกได้ว่าใครกด
  private async actorsOf(actorIds: (string | null)[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(actorIds.filter((v): v is string => v !== null))];
    if (ids.length === 0) return new Map();
    const rows: { id: string; full_name: string | null }[] = await this.dataSource.query(
      `SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  private actorRef(actorId: string | null, names: Map<string, string | null>): UserRefView | null {
    // NULL = ระบบ (job ปิดอัตโนมัติ / ยกระดับ urgent เอง)
    return actorId === null ? null : { id: actorId, name: names.get(actorId) ?? null };
  }
}
