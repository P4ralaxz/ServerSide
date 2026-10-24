import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notFound } from '../../common/errors/errors';
import { Asset, User } from '../../database/entities';
import { TicketPolicy } from '../tickets/ticket-policy.service';
import { TicketQueryService } from '../tickets/ticket-query.service';
import { ScanOpenTicketView, ScanView } from './scan.dto';

// หน้าแรกหลังสแกน QR (DESIGN 7.4): ดูสถานะของที่แจ้งไปแล้วได้ก่อน ไม่ใช่พาไปฟอร์มทันที
// ไม่มีกฎของตัวเอง — open_ticket ผ่าน canSee, actions ผ่าน allowedActions, can_report ผ่าน canReport
// ทั้งสามตัวเป็นฟังก์ชันเดียวกับที่ endpoint ของใบใช้ หน้าจอจึงไม่มีทางโชว์ปุ่มที่กดแล้วโดนปฏิเสธ
@Injectable()
export class ScanService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: TicketPolicy,
    private readonly tickets: TicketQueryService,
  ) {}

  async scan(user: User, qrToken: string): Promise<ScanView> {
    // ไม่พบ กับถูก soft delete ตอบเหมือนกัน (find ของ repository ข้ามแถวที่ deleted_at ไม่ว่างให้เอง)
    const asset = await this.dataSource.getRepository(Asset).findOne({ where: { qrToken } });
    if (!asset) throw notFound('ไม่พบครุภัณฑ์ของ QR นี้');

    const [place]: { building_name: string; room_no: string | null }[] = await this.dataSource.query(
      `SELECT b.name AS building_name, r.room_no
         FROM buildings b LEFT JOIN rooms r ON r.id = $2
        WHERE b.id = $1`,
      [asset.buildingId, asset.roomId],
    );

    const { visible, busy } = await this.tickets.openTicketsOf(user, [asset.id]);
    const ticket = visible.get(asset.id);
    let openTicket: ScanOpenTicketView | null = null;
    if (ticket) {
      const reported: unknown[] = await this.dataSource.query(
        `SELECT 1 FROM ticket_reporters WHERE ticket_id = $1 AND user_id = $2`,
        [ticket.id, user.id],
      );
      openTicket = {
        id: ticket.id,
        ticket_no: ticket.ticketNo,
        status: ticket.status,
        updated_at: ticket.updatedAt,
        reported_by_me: reported.length > 0,
        actions: this.policy.allowedActions(user, ticket, { alreadyReported: reported.length > 0 }),
      };
    }

    return {
      asset: {
        id: asset.id,
        asset_code: asset.assetCode,
        name: asset.name,
        category: asset.category,
        location_note: asset.locationNote,
        building: { id: asset.buildingId, name: place.building_name },
        room: asset.roomId === null ? null : { id: asset.roomId, room_no: place.room_no ?? '' },
      },
      open_ticket: openTicket,
      // ตัวเดียวกับที่ POST /tickets ใช้ตัดสิน 403 — ห้ามคิดเงื่อนไขชุดใหม่ที่นี่
      // มีใบเปิดอยู่แล้ว (แม้ผู้ใช้จะมองไม่เห็น) = แจ้งใหม่ไม่ได้ ให้กดเจอปัญหาเดียวกันแทน
      can_report: this.policy.canReport(user, asset) && !busy.has(asset.id),
    };
  }
}
