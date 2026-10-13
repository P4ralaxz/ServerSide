import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AUDIT_ACTIONS, AuditAction } from '../../domain/enums';

// รายละเอียดของ audit เป็นค่าพื้นฐานเท่านั้น (from/to/report_count) — ไม่ซ้อน object
// พิมพ์ให้แคบไว้เพื่อให้ null ใส่ได้จริง (TypeORM ปฏิเสธ null ใน jsonb ที่ประกาศเป็น unknown)
export type AuditDetail = Record<string, string | number | boolean | null>;

@Entity('ticket_audit_logs')
export class TicketAuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ type: 'enum', enum: [...AUDIT_ACTIONS], enumName: 'audit_action' })
  action: AuditAction;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'jsonb', default: {} })
  detail: AuditDetail;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
