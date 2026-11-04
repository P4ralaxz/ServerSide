import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { forbidden } from '../../common/errors/errors';
import { TicketComment, User } from '../../database/entities';
import { UserRole } from '../../domain/enums';
import { TicketPolicy } from './ticket-policy.service';
import { TicketQueryService } from './ticket-query.service';
import { CommentView, CreateCommentDto } from './tickets.dto';

interface CommentRow {
  id: string;
  body: string;
  is_internal: boolean;
  created_at: Date;
  author_id: string;
  author_name: string | null;
  author_role: UserRole;
}

// ความเห็นในใบ — ไม่เปลี่ยนขั้นและไม่ใช่ audit จึงอยู่ตารางของตัวเอง ไม่ลง status log / audit log
@Injectable()
export class TicketCommentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: TicketPolicy,
    private readonly tickets: TicketQueryService,
  ) {}

  async list(user: User, ticketId: string): Promise<CommentView[]> {
    const ticket = await this.tickets.loadVisible(user, ticketId);
    return this.query(ticket.id, this.policy.canSeeInternal(user));
  }

  // ลำดับตามกฎข้อ 3: มองไม่เห็น (404) → ownership (403) → ความเห็นภายในของนักศึกษา (403)
  // ไม่มีชั้นสถานะ (409): ใบที่จบแล้วยังคุยต่อได้ (DESIGN 7)
  async create(user: User, ticketId: string, dto: CreateCommentDto): Promise<CommentView> {
    const ticket = await this.tickets.loadVisible(user, ticketId);
    this.policy.assertCan('comment', user, ticket);
    const isInternal = dto.is_internal ?? false;
    if (isInternal && !this.policy.canSeeInternal(user)) throw forbidden('นักศึกษาเขียนความเห็นภายในไม่ได้');

    const saved = await this.dataSource
      .getRepository(TicketComment)
      .save({ ticketId: ticket.id, authorId: user.id, body: dto.body, isInternal });
    const [view] = await this.query(ticket.id, true, saved.id);
    return view;
  }

  // raw SQL ไม่ผ่าน @DeleteDateColumn — ต้องกรอง deleted_at เองทุกตาราง (CLAUDE.md)
  // ไม่กรอง deleted_at ของผู้เขียน: บัญชีที่ถูกลบไปแล้ว ความเห็นเก่ายังต้องบอกได้ว่าใครเขียน
  private async query(ticketId: string, withInternal: boolean, onlyId?: string): Promise<CommentView[]> {
    const rows: CommentRow[] = await this.dataSource.query(
      `SELECT c.id, c.body, c.is_internal, c.created_at,
              u.id AS author_id, u.full_name AS author_name, u.role AS author_role
         FROM ticket_comments c
         JOIN users u ON u.id = c.author_id
        WHERE c.ticket_id = $1
          AND c.deleted_at IS NULL
          AND ($2::boolean OR NOT c.is_internal)
          AND ($3::bigint IS NULL OR c.id = $3)
        ORDER BY c.created_at, c.id`,
      [ticketId, withInternal, onlyId ?? null],
    );
    return rows.map((r) => ({
      id: String(r.id),
      body: r.body,
      is_internal: r.is_internal,
      created_at: r.created_at,
      author: { id: r.author_id, name: r.author_name, role: r.author_role },
    }));
  }
}
