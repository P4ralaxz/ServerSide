import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppException } from '../../common/errors/domain-errors';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { formatTicketNo, thaiBuddhistYear } from '../../common/time/thai-year';
import { Asset, Ticket, TicketAuditLog, TicketStatusLog, User } from '../../database/entities';
import { AUTO_URGENT_REPORT_COUNT, OPEN_TICKET_QUOTA } from '../../domain/limits';
import { isOpenStatus, OPEN_STATUSES } from '../../domain/status-rules';
import { TicketPolicy } from './ticket-policy.service';
import {
  CreateTicketItemDto,
  CreateTicketsDto,
  CreateTicketsResponse,
  SkippedItemView,
  TicketView,
  toTicketView,
} from './tickets.dto';

// predicate ของ idx_tickets_asset_open — สร้างจาก OPEN_STATUSES เพื่อไม่ให้มีรายการสถานะเขียนซ้ำอีกที่
// ON CONFLICT ต้องระบุ predicate ให้ตรงกับ partial index ไม่งั้น Postgres หา index ไม่เจอ (42P10)
// ค่ามาจากค่าคงที่ในโค้ด ไม่ใช่ข้อมูลจากผู้ใช้ จึงต่อ string ได้
const OPEN_PREDICATE = `status IN (${OPEN_STATUSES.map((s) => `'${s}'`).join(',')}) AND deleted_at IS NULL`;

@Injectable()
export class TicketCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: TicketPolicy,
  ) {}

  async create(user: User, dto: CreateTicketsDto): Promise<CreateTicketsResponse> {
    // --- ก่อนเข้าทรานแซกชัน: ความถูกต้องของคำขอ (400/404) แล้วจึงสิทธิ์ (403) ---
    const assets = await this.dataSource
      .getRepository(Asset)
      .find({ where: { id: In(dto.items.map((i) => i.asset_id)) } });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    // ไม่เจอแม้ชิ้นเดียว (รวมถูก soft delete) → 404 ทั้งคำขอ
    if (assetById.size !== dto.items.length) throw notFound('ไม่พบครุภัณฑ์ที่ระบุ');

    for (const item of dto.items) this.assertItemMatchesAsset(item, assetById.get(item.asset_id)!);

    // policy ทุกรายการก่อนแตะเรื่องแจ้งซ้ำ: ไม่มีสิทธิ์แม้รายการเดียว → 403 ทั้งคำขอ
    // ไม่ใช่ skipped เพราะเป็นการละเมิดสิทธิ์ ไม่ใช่ความขัดแย้งของสถานะ
    for (const asset of assets) this.policy.assertCanReport(user, asset);

    return this.dataSource.transaction(async (m) => {
      // ลำดับตายตัว: lock users → lock ticket_counters → เช็คซ้ำ → จองเลขทั้งชุด → INSERT
      const openCount = user.role === 'student' ? await this.lockReporterAndCountOpen(m, user.id) : 0;

      // ปี พ.ศ. คิดครั้งเดียวต่อคำขอ: lock กับการจองเลขต้องเป็นแถวเดียวกัน แม้คำขอคร่อมเที่ยงคืนวันสิ้นปี
      const beYear = thaiBuddhistYear();
      await this.lockTicketCounter(m, beYear);

      // เช็คซ้ำ "หลัง" ได้ lock ของ counter: ตอนนี้ไม่มี batch อื่นกำลังสร้างใบอยู่ ภาพที่อ่านได้จึงเป็นภาพล่าสุดจริง
      // รายการที่ซ้ำจึงถูกคัดออกก่อนจองเลข — เลขใบไม่ข้าม
      const skipped = new Map<string, SkippedItemView>();
      for (const row of await this.findOpenTickets(m, [...assetById.keys()])) skipped.set(row.asset_id, row);

      // การแทรกไม่ต้องเรียงตาม asset_id เพราะทุก batch ต้องได้ lock ของ ticket_counters ก่อนแทรกใบแรก
      // (และถือไว้จนจบทรานแซกชัน สอง batch จึงแทรกใบสลับกันจน deadlock ไม่ได้)
      // ถ้าเปลี่ยนวิธีจองเลขใบ ต้องกลับมาเรียงตาม asset_id
      const toCreate = dto.items.filter((i) => !skipped.has(i.asset_id));
      const batchId = randomUUID();
      const created = new Map<string, Ticket>();

      if (toCreate.length > 0) {
        const numbers = await this.reserveTicketNumbers(m, beYear, toCreate.length);
        for (const [idx, item] of toCreate.entries()) {
          const asset = assetById.get(item.asset_id)!;
          const ticket = await this.insertTicket(m, user, asset, item, batchId, numbers[idx]);
          if (ticket) {
            created.set(asset.id, ticket);
          } else {
            // ด่านสุดท้าย: ON CONFLICT จับได้ว่ามีใบเปิดอยู่ทั้งที่การเช็คข้างบนไม่เห็น
            // (ไม่ควรเกิดตราบใดที่ทุกทางสร้างใบผ่าน lock ของ counter) — เลขที่จองไว้เสียไปหนึ่งเลข ยอมรับได้
            const [row] = await this.findOpenTickets(m, [asset.id]);
            if (row) skipped.set(asset.id, row);
          }
        }
      }

      // โควตานับเฉพาะใบที่สร้างได้จริง รายการที่ซ้ำไม่กินโควตา — เกินแล้วโยน error ให้ทั้งทรานแซกชันถอยกลับ
      if (user.role === 'student' && openCount + created.size > OPEN_TICKET_QUOTA) {
        throw new AppException(
          HttpStatus.TOO_MANY_REQUESTS,
          'QUOTA_EXCEEDED',
          `มีใบแจ้งซ่อมที่ยังไม่ปิดได้ไม่เกิน ${OPEN_TICKET_QUOTA} ใบ`,
          { open_count: openCount, limit: OPEN_TICKET_QUOTA },
        );
      }

      // คืนผลตามลำดับที่ผู้ใช้ส่งมา ไม่ใช่ลำดับที่แทรก
      const skippedList = dto.items.flatMap((i) => skipped.get(i.asset_id) ?? []);
      if (created.size === 0) {
        throw conflict('DUPLICATE_OPEN_TICKET', 'ครุภัณฑ์นี้มีใบแจ้งซ่อมที่ยังไม่ปิดอยู่แล้ว', {
          skipped: skippedList,
        });
      }
      return {
        batch_id: batchId,
        created: dto.items.flatMap((i) => {
          const t = created.get(i.asset_id);
          return t ? toTicketView(t, assetById.get(i.asset_id)!.buildingId) : [];
        }),
        skipped: skippedList,
      };
    });
  }

  async sameIssue(user: User, ticketId: string): Promise<TicketView> {
    return this.dataSource.transaction(async (m) => {
      // lock แถวก่อนอ่าน: report_count / priority / disputed_at ถูกแก้จากค่าที่อ่านได้ในทรานแซกชันนี้
      const ticket = await m
        .getRepository(Ticket)
        .findOne({ where: { id: ticketId }, lock: { mode: 'pessimistic_write' } });
      // ชั้น 0: ใบที่มองไม่เห็นตอบ 404 เหมือนใบที่ไม่มี (403 จะยืนยันว่าใบ id นี้มีอยู่จริง)
      if (!ticket || !this.policy.canSee(user, ticket)) throw notFound('ไม่พบใบแจ้งซ่อม');
      this.policy.assertCan('same_issue', user, ticket); // ชั้น 2 → 403
      if (!isOpenStatus(ticket.status)) {
        throw conflict('TICKET_NOT_OPEN', 'ใบแจ้งซ่อมนี้ปิดไปแล้ว กรุณาแจ้งใบใหม่', { status: ticket.status }); // ชั้น 3 → 409
      }

      // 1 คน 1 ครั้ง: PK (ticket_id, user_id) เป็นคนตัดสิน ไม่ใช่การ SELECT ก่อน — กดรัวพร้อมกันก็นับได้ครั้งเดียว
      const inserted: unknown[] = await m.query(
        `INSERT INTO ticket_reporters (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id`,
        [ticket.id, user.id],
      );
      if (inserted.length === 0) {
        throw conflict('ALREADY_REPORTED', 'คุณแจ้งปัญหานี้ไปแล้ว', { already_reported: true });
      }

      ticket.reportCount += 1;
      await m.getRepository(TicketAuditLog).insert({
        ticketId: ticket.id,
        action: 'same_issue',
        actorId: user.id,
        detail: { report_count: ticket.reportCount },
      });

      // ยกเป็น urgent ครั้งเดียวต่อใบ: ถ้า Staff ลด priority ลงเองทีหลัง ระบบไม่ยกกลับอีก
      if (ticket.reportCount > AUTO_URGENT_REPORT_COUNT && ticket.priority !== 'urgent') {
        const escalatedBefore = await m.getRepository(TicketAuditLog).exists({
          where: { ticketId: ticket.id, action: 'auto_escalate' },
        });
        if (!escalatedBefore) {
          await m.getRepository(TicketAuditLog).insert({
            ticketId: ticket.id,
            action: 'auto_escalate',
            actorId: null, // ระบบ
            detail: { from: ticket.priority, to: 'urgent', report_count: ticket.reportCount },
          });
          ticket.priority = 'urgent';
        }
      }

      // ส่วนกลาง: Staff เป็นคนยืนยัน แต่คนใช้งานจริงคือนักศึกษา — มีคนบอกว่ายังเสียหลังช่างกด resolved
      // ให้ job ปิดอัตโนมัติข้ามใบนี้ รอ Staff ตัดสินเอง
      if (ticket.status === 'resolved' && ticket.scope === 'common_area' && !ticket.disputedAt) {
        ticket.disputedAt = new Date();
      }

      await m.getRepository(Ticket).save(ticket);
      const saved = await m.getRepository(Ticket).findOneByOrFail({ id: ticket.id });
      const asset = await m.getRepository(Asset).findOneOrFail({ where: { id: ticket.assetId }, withDeleted: true });
      return toTicketView(saved, asset.buildingId);
    });
  }

  // scope / room_id ไม่จำเป็นต้องส่ง แต่ถ้าส่งมาต้องตรงกับครุภัณฑ์
  // กันการแจ้งแอร์ห้องคนอื่นโดยติดป้าย "ส่วนกลาง" เพื่อหลบการเช็คเจ้าของห้อง — ระบบไม่เคยเชื่อ scope จากคำขอ
  private assertItemMatchesAsset(item: CreateTicketItemDto, asset: Asset): void {
    const scope = asset.roomId ? 'room' : 'common_area';
    if (item.scope !== undefined && item.scope !== scope) {
      throw badRequest('SCOPE_MISMATCH', 'scope ไม่ตรงกับครุภัณฑ์', { asset_id: asset.id });
    }
    if (item.room_id !== undefined && item.room_id !== asset.roomId) {
      throw badRequest('ROOM_MISMATCH', 'room_id ไม่ตรงกับห้องของครุภัณฑ์', { asset_id: asset.id });
    }
    if (item.permission_to_enter && scope !== 'room') {
      throw badRequest('PERMISSION_NOT_APPLICABLE', 'permission_to_enter ใช้กับครุภัณฑ์ในห้องพักเท่านั้น', {
        asset_id: asset.id,
      });
    }
  }

  // ต้อง lock แถว users ก่อนนับ: ยิง batch สองชุดพร้อมกันโดยไม่ lock จะนับจากภาพเดียวกันแล้วทะลุโควตาทั้งคู่
  private async lockReporterAndCountOpen(m: EntityManager, userId: string): Promise<number> {
    await m.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const [row]: { n: number }[] = await m.query(
      `SELECT count(*)::int AS n FROM tickets WHERE reporter_id = $1 AND ${OPEN_PREDICATE}`,
      [userId],
    );
    return row.n;
  }

  private findOpenTickets(m: EntityManager, assetIds: string[]): Promise<SkippedItemView[]> {
    return m.query(
      `SELECT asset_id, ticket_no, id AS ticket_id FROM tickets WHERE asset_id = ANY($1::uuid[]) AND ${OPEN_PREDICATE}`,
      [assetIds],
    );
  }

  // row lock ของตัวนับประจำปี ถือไว้จนจบทรานแซกชัน — เป็นประตูเดียวของการสร้างใบทั้งระบบ
  // สิ่งที่พึ่ง lock นี้: (1) เลขใบไม่ชน (2) การเช็คแจ้งซ้ำเห็นภาพล่าสุด (3) การแทรกของสอง batch ไม่สลับกัน จึงไม่ต้องเรียงตาม asset_id
  // ถ้าเปลี่ยนวิธีจองเลขใบ (เช่น ใช้ sequence ที่ไม่ lock) ทั้งสามข้อหายไปพร้อมกัน — ต้องกลับไปเรียงลำดับแทรกตาม asset_id
  private async lockTicketCounter(m: EntityManager, beYear: number): Promise<void> {
    // แถวของปีใหม่ยังไม่มีในใบแรกของปี — สร้างไว้ก่อนเพื่อให้มีแถวให้ lock (DO NOTHING รอทรานแซกชันที่กำลังสร้างแถวเดียวกันอยู่)
    await m.query(`INSERT INTO ticket_counters (be_year, last_no) VALUES ($1, 0) ON CONFLICT (be_year) DO NOTHING`, [
      beYear,
    ]);
    await m.query(`SELECT 1 FROM ticket_counters WHERE be_year = $1 FOR UPDATE`, [beYear]);
  }

  // จองเลขทั้งชุดในคำสั่งเดียว — ต้องเรียกหลัง lockTicketCounter ในทรานแซกชันเดียวกันเท่านั้น
  private async reserveTicketNumbers(m: EntityManager, beYear: number, count: number): Promise<string[]> {
    const [[row]]: [{ last_no: number }[], number] = await m.query(
      `UPDATE ticket_counters SET last_no = last_no + $2 WHERE be_year = $1 RETURNING last_no`,
      [beYear, count],
    );
    return Array.from({ length: count }, (_, i) => formatTicketNo(beYear, row.last_no - count + 1 + i));
  }

  // คืน null เมื่อครุภัณฑ์มีใบเปิดอยู่แล้ว
  private async insertTicket(
    m: EntityManager,
    user: User,
    asset: Asset,
    item: CreateTicketItemDto,
    batchId: string,
    ticketNo: string,
  ): Promise<Ticket | null> {
    // ON CONFLICT … DO NOTHING แทนการ try/catch 23505: unique violation ทำให้ Postgres abort ทั้งทรานแซกชัน
    // ใบที่เหลือใน batch จะสร้างต่อไม่ได้
    const rows: { id: string }[] = await m.query(
      `INSERT INTO tickets (ticket_no, batch_id, asset_id, scope, room_id, reporter_id, title, description, permission_to_enter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (asset_id) WHERE ${OPEN_PREDICATE} DO NOTHING
       RETURNING id`,
      [
        ticketNo,
        batchId,
        asset.id,
        asset.roomId ? 'room' : 'common_area',
        asset.roomId,
        user.id,
        item.title,
        item.description ?? null,
        item.permission_to_enter ?? false,
      ],
    );
    if (rows.length === 0) return null;

    const ticketId = rows[0].id;
    await m.getRepository(TicketStatusLog).insert({ ticketId, fromStatus: null, toStatus: 'open', actorId: user.id });
    // ผู้แจ้งนับเป็นคนแรกใน ticket_reporters — กด same-issue ใบของตัวเองจึงได้ 409
    await m.query(`INSERT INTO ticket_reporters (ticket_id, user_id) VALUES ($1, $2)`, [ticketId, user.id]);
    return m.getRepository(Ticket).findOneByOrFail({ id: ticketId });
  }
}
