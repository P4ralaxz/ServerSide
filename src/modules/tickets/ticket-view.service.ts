import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { Env } from '../../config/env';
import { Ticket, User } from '../../database/entities';
import { autoCloseAt } from '../../domain/auto-close';
import { TicketPolicy } from './ticket-policy.service';
import { AssetRefView, BuildingRefView, RoomRefView, TicketView, UserRefView } from './tickets.dto';

interface AssetRow {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  building_id: string;
  building_name: string;
}

// ประกอบ TicketView ที่เดียว — list, detail และทุก endpoint ที่เปลี่ยนสถานะคืนรูปร่างเดียวกัน
// ทุก join ทำเป็นชุด (ตาม id ที่รวบรวมได้) ไม่ใช่ต่อแถว — GET /tickets จึงยิง query เท่าเดิมไม่ว่าจะมีกี่ใบ
@Injectable()
export class TicketViewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: TicketPolicy,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async of(user: User, tickets: Ticket[], m?: EntityManager): Promise<TicketView[]> {
    if (tickets.length === 0) return [];
    const q = m ?? this.dataSource.manager;
    const ids = (values: (string | null)[]): string[] => [...new Set(values.filter((v): v is string => v !== null))];

    // ไม่กรอง deleted_at ของ assets / rooms / buildings / users โดยเจตนา:
    // ใบเก่ายังต้องบอกได้ว่าเป็นครุภัณฑ์ชิ้นไหน อยู่ห้องไหน และช่างคนไหนเคยรับงาน
    // แม้ของพวกนั้นถูก soft delete ไปแล้ว (ตัวใบเองถูกกรองที่ visibilityFilter แล้ว)
    const assetRows: AssetRow[] = await q.query(
      `SELECT a.id, a.asset_code, a.name, a.category, a.building_id, b.name AS building_name
         FROM assets a JOIN buildings b ON b.id = a.building_id
        WHERE a.id = ANY($1::uuid[])`,
      [ids(tickets.map((t) => t.assetId))],
    );
    const assets = new Map(assetRows.map((r) => [r.id, r]));

    const roomIds = ids(tickets.map((t) => t.roomId));
    const roomRows: { id: string; room_no: string }[] = roomIds.length
      ? await q.query(`SELECT id, room_no FROM rooms WHERE id = ANY($1::uuid[])`, [roomIds])
      : [];
    const rooms = new Map(roomRows.map((r) => [r.id, r]));

    const assigneeIds = ids(tickets.map((t) => t.assignedTo));
    const userRows: { id: string; full_name: string | null }[] = assigneeIds.length
      ? await q.query(`SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`, [assigneeIds])
      : [];
    const assignees = new Map(userRows.map((r) => [r.id, r]));

    const ticketIds = tickets.map((t) => t.id);
    const reopenNotes = await this.lastReopenNotes(q, ticketIds);
    const partsNotes = await this.waitingParts(q, tickets);
    // ใบที่ผู้ใช้คนนี้กด "เจอปัญหาเดียวกัน" ไปแล้ว — อ่านเป็นชุดเดียว ไม่ใช่ต่อแถว
    const reportedRows: { ticket_id: string }[] = await q.query(
      `SELECT ticket_id FROM ticket_reporters WHERE user_id = $1 AND ticket_id = ANY($2::uuid[])`,
      [user.id, ticketIds],
    );
    const reportedByMe = new Set(reportedRows.map((r) => r.ticket_id));
    const afterHours = this.config.get('AUTO_CLOSE_AFTER_HOURS', { infer: true });

    return tickets.map((t) => {
      const asset = assets.get(t.assetId);
      const room = t.roomId === null ? null : rooms.get(t.roomId);
      const assignee = t.assignedTo === null ? null : assignees.get(t.assignedTo);
      return {
        id: t.id,
        ticket_no: t.ticketNo,
        batch_id: t.batchId,
        asset_id: t.assetId,
        building_id: asset?.building_id ?? '',
        scope: t.scope,
        room_id: t.roomId,
        reporter_id: t.reporterId,
        assigned_to: t.assignedTo,
        status: t.status,
        priority: t.priority,
        title: t.title,
        description: t.description,
        report_count: t.reportCount,
        reopen_count: t.reopenCount,
        permission_to_enter: t.permissionToEnter,
        scheduled_at: t.scheduledAt,
        resolved_at: t.resolvedAt,
        closed_at: t.closedAt,
        confirmed_by: t.confirmedBy,
        close_reason: t.closeReason,
        disputed_at: t.disputedAt,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        asset: this.assetRef(asset),
        room: room ? ({ id: room.id, room_no: room.room_no } satisfies RoomRefView) : null,
        building: { id: asset?.building_id ?? '', name: asset?.building_name ?? '' } satisfies BuildingRefView,
        assignee: assignee ? ({ id: assignee.id, name: assignee.full_name } satisfies UserRefView) : null,
        last_reopen_note: reopenNotes.get(t.id) ?? null,
        waiting_for_parts: partsNotes.get(t.id) ?? null,
        auto_close_at: autoCloseAt(t, afterHours),
        // ปุ่มคิดจาก policy ตัวเดียวกับที่ endpoint ใช้ — ไม่มี query เพิ่มต่อแถว
        actions: this.policy.allowedActions(user, t, { alreadyReported: reportedByMe.has(t.id) }),
      };
    });
  }

  // ใช้หลัง endpoint ที่เปลี่ยนสถานะ: อ่านใบที่เพิ่ง commit แล้วคืนรูปร่างเดียวกับ GET /tickets/:id
  async one(user: User, ticketId: string, m?: EntityManager): Promise<TicketView> {
    const q = m ?? this.dataSource.manager;
    const ticket = await q.getRepository(Ticket).findOneByOrFail({ id: ticketId });
    const [view] = await this.of(user, [ticket], m);
    return view;
  }

  // note ของการส่งกลับครั้งล่าสุดต่อใบ — DISTINCT ON ทำให้ได้แถวเดียวต่อใบในคำสั่งเดียว (ไม่ใช่ต่อแถว)
  private async lastReopenNotes(q: EntityManager, ticketIds: string[]): Promise<Map<string, string | null>> {
    const rows: { ticket_id: string; note: string | null }[] = await q.query(
      `SELECT DISTINCT ON (ticket_id) ticket_id, note
         FROM ticket_status_logs
        WHERE ticket_id = ANY($1::uuid[]) AND from_status = 'resolved' AND to_status = 'assigned'
        ORDER BY ticket_id, created_at DESC, id DESC`,
      [ticketIds],
    );
    return new Map(rows.map((r) => [r.ticket_id, r.note]));
  }

  // อะไหล่ที่ใบนี้รออยู่ = note ของการเข้าขั้น pending_parts ครั้งล่าสุด (API บังคับ note ตอนเข้าขั้นนี้)
  // ส่งเฉพาะใบที่ยังรออะไหล่อยู่ตอนนี้ — ใบที่ซ่อมต่อแล้ว note เก่าไม่ใช่สิ่งที่ "รออยู่" อีกต่อไป
  // รายการงานของช่างแสดงค่านี้ทุกแถว (UI-PLAN 5) จึงอ่านเป็นชุดเดียว ไม่ให้หน้าเว็บยิง history ทีละใบ
  private async waitingParts(q: EntityManager, tickets: Ticket[]): Promise<Map<string, string | null>> {
    const waiting = tickets.filter((t) => t.status === 'pending_parts').map((t) => t.id);
    if (waiting.length === 0) return new Map();
    const rows: { ticket_id: string; note: string | null }[] = await q.query(
      `SELECT DISTINCT ON (ticket_id) ticket_id, note
         FROM ticket_status_logs
        WHERE ticket_id = ANY($1::uuid[]) AND to_status = 'pending_parts'
        ORDER BY ticket_id, created_at DESC, id DESC`,
      [waiting],
    );
    return new Map(rows.map((r) => [r.ticket_id, r.note]));
  }

  private assetRef(asset?: AssetRow): AssetRefView {
    // ครุภัณฑ์หายไปจาก DB ไม่ได้ (FK + ลบจริงไม่ได้) — ค่าว่างมีไว้ให้ type ปิด ไม่ใช่เส้นทางที่เกิดจริง
    return {
      id: asset?.id ?? '',
      asset_code: asset?.asset_code ?? '',
      name: asset?.name ?? '',
      category: asset?.category ?? '',
    };
  }
}
