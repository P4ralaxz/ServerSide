import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { notFound } from '../../common/errors/errors';
import { Ticket, TicketAuditLog, TicketStatusLog, User } from '../../database/entities';
import { TICKET_LIST_DEFAULT_LIMIT } from '../../domain/limits';
import { OPEN_STATUSES } from '../../domain/status-rules';
import { QUEUE_COUNTERS, QueueCounter, ticketFilters } from './ticket-filters';
import { TicketPolicy } from './ticket-policy.service';
import { TicketViewService } from './ticket-view.service';
import { HistoryEntryView, ListTicketsQuery, QueueCountsView, TicketView, UserRefView } from './tickets.dto';

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
    for (const f of ticketFilters(q, user.id)) qb.andWhere(f.sql, f.params);

    const tickets = await qb
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.ticket_no', 'DESC')
      .take(q.limit ?? TICKET_LIST_DEFAULT_LIMIT)
      .skip(q.offset ?? 0)
      .getMany();

    // join ทั้งหมดทำเป็นชุดใน TicketViewService — จำนวน query ไม่ขึ้นกับจำนวนใบในหน้านี้
    return this.views.of(user, tickets);
  }

  // ตัวเลขทุกชิปในคำสั่งเดียว: COUNT(*) FILTER ต่อตัวนับ โดยเงื่อนไขมาจาก ticketFilters ตัวเดียวกับ GET /tickets
  async queueCounts(user: User): Promise<QueueCountsView> {
    const qb = this.policy.visibilityFilter(user, this.dataSource.getRepository(Ticket).createQueryBuilder('t'));
    qb.select([]);
    for (const [name, query] of Object.entries(QUEUE_COUNTERS)) {
      const filters = ticketFilters(query, user.id, `${name}_`);
      qb.addSelect(`COUNT(*) FILTER (WHERE ${filters.map((f) => `(${f.sql})`).join(' AND ')})::int`, name);
      for (const f of filters) qb.setParameters(f.params);
    }
    const counts = await qb.getRawOne<Record<QueueCounter, number>>();
    return counts!;
  }

  // ใบที่ยังเปิดอยู่ของครุภัณฑ์ชุดหนึ่งในคำสั่งเดียว (DESIGN 7.4, 7.5) — ห้ามถามทีละชิ้น
  //   visible = เฉพาะใบที่ผู้ใช้คนนี้มองเห็น: canSee ตัวเดียวกับ GET /tickets/:id
  //             สแกน QR ของห้องอื่นต้องไม่รู้ว่าห้องนั้นแจ้งอะไรไว้ (กติกาเดียวกับ ownership ก่อน duplicate ใน 4.1)
  //   busy    = มีใบเปิดอยู่ ไม่ว่าผู้ใช้คนนี้จะเห็นหรือไม่ — ใช้ตัดสินว่าแจ้งใหม่ได้ไหมเท่านั้น ห้ามส่งออกไปเป็นข้อมูลใบ
  async openTicketsOf(user: User, assetIds: string[]): Promise<{ visible: Map<string, Ticket>; busy: Set<string> }> {
    if (assetIds.length === 0) return { visible: new Map(), busy: new Set() };
    // find ของ repository กรอง deleted_at ให้เองผ่าน @DeleteDateColumn (ต่างจาก manager.query)
    const open = await this.dataSource
      .getRepository(Ticket)
      .find({ where: { assetId: In(assetIds), status: In([...OPEN_STATUSES]) } });
    return {
      visible: new Map(open.filter((t) => this.policy.canSee(user, t)).map((t) => [t.assetId, t])),
      busy: new Set(open.map((t) => t.assetId)),
    };
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

  // ชั้น 0 ของทุก endpoint ที่อ่านใบตาม id (รวม comments)
  async loadVisible(user: User, id: string): Promise<Ticket> {
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
