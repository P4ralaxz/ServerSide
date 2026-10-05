import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { notFound } from '../../common/errors/errors';
import { Asset, Ticket, TicketStatusLog, User } from '../../database/entities';
import { TICKET_LIST_DEFAULT_LIMIT } from '../../domain/limits';
import { TicketPolicy } from './ticket-policy.service';
import { ListTicketsQuery, TicketDetailView, TicketView, toStatusLogView, toTicketView } from './tickets.dto';

@Injectable()
export class TicketQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: TicketPolicy,
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

    const buildings = await this.buildingOfAssets(tickets.map((t) => t.assetId));
    return tickets.map((t) => toTicketView(t, buildings.get(t.assetId)!));
  }

  async detail(user: User, id: string): Promise<TicketDetailView> {
    const ticket = await this.policy
      .visibilityFilter(user, this.dataSource.getRepository(Ticket).createQueryBuilder('t'))
      .andWhere('t.id = :id', { id })
      .getOne();
    // มองไม่เห็น = ไม่พบ: ตอบ 404 เหมือนกันทั้งสองกรณี ไม่บอกว่าใบ id นี้มีอยู่จริงหรือไม่
    if (!ticket) throw notFound('ไม่พบใบแจ้งซ่อม');

    const logs = await this.dataSource
      .getRepository(TicketStatusLog)
      .find({ where: { ticketId: ticket.id }, order: { createdAt: 'ASC', id: 'ASC' } });
    const buildings = await this.buildingOfAssets([ticket.assetId]);
    return { ...toTicketView(ticket, buildings.get(ticket.assetId)!), status_logs: logs.map(toStatusLogView) };
  }

  // รวมครุภัณฑ์ที่ถูก soft delete ไปแล้วด้วย — ใบเก่ายังต้องบอกได้ว่าอยู่อาคารไหน
  private async buildingOfAssets(assetIds: string[]): Promise<Map<string, string>> {
    if (assetIds.length === 0) return new Map();
    const assets = await this.dataSource
      .getRepository(Asset)
      .find({ where: { id: In([...new Set(assetIds)]) }, withDeleted: true, select: { id: true, buildingId: true } });
    return new Map(assets.map((a) => [a.id, a.buildingId]));
  }
}
