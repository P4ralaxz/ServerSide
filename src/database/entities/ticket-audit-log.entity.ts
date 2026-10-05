import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AUDIT_ACTIONS, AuditAction } from '../../domain/enums';

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
  detail: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
