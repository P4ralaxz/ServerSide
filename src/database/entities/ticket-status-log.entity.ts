import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TICKET_STATUSES, TicketStatus } from '../../domain/enums';

// เฉพาะการเปลี่ยนขั้นจริง (ck_real_transition) — assign ซ้ำ / เลื่อนนัด / priority ไป TicketAuditLog
@Entity('ticket_status_logs')
export class TicketStatusLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'from_status', type: 'enum', enum: [...TICKET_STATUSES], enumName: 'ticket_status', nullable: true })
  fromStatus: TicketStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: [...TICKET_STATUSES], enumName: 'ticket_status' })
  toStatus: TicketStatus;

  // NULL = ระบบ
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
