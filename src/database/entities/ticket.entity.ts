import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import {
  CLOSE_REASONS,
  CloseReason,
  TICKET_PRIORITIES,
  TICKET_SCOPES,
  TICKET_STATUSES,
  TicketPriority,
  TicketScope,
  TicketStatus,
} from '../../domain/enums';

// ไม่มีความสัมพันธ์ไปตารางรายการย่อย: 1 ticket = 1 ครุภัณฑ์ (กฎข้อ 1)
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ticket_no', type: 'text' })
  ticketNo: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId: string;

  @Column({ type: 'enum', enum: [...TICKET_SCOPES], enumName: 'ticket_scope' })
  scope: TicketScope;

  // snapshot ตอนแจ้ง ใช้เช็คสิทธิ์ — ไม่ตามครุภัณฑ์ที่ถูกย้ายห้องทีหลัง
  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @Column({ name: 'assigned_to', type: 'uuid', nullable: true })
  assignedTo: string | null;

  @Column({ type: 'enum', enum: [...TICKET_STATUSES], enumName: 'ticket_status', default: 'open' })
  status: TicketStatus;

  @Column({ type: 'enum', enum: [...TICKET_PRIORITIES], enumName: 'ticket_priority', default: 'normal' })
  priority: TicketPriority;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'report_count', type: 'int', default: 1 })
  reportCount: number;

  @Column({ name: 'reopen_count', type: 'int', default: 0 })
  reopenCount: number;

  @Column({ name: 'permission_to_enter', type: 'boolean', default: false })
  permissionToEnter: boolean;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'confirmed_by', type: 'uuid', nullable: true })
  confirmedBy: string | null;

  @Column({ name: 'close_reason', type: 'enum', enum: [...CLOSE_REASONS], enumName: 'close_reason', nullable: true })
  closeReason: CloseReason | null;

  @Column({ name: 'disputed_at', type: 'timestamptz', nullable: true })
  disputedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // ไม่ใช้ @UpdateDateColumn: trigger trg_tickets_updated ใน DB เป็นคนตั้งค่า ถ้าให้ TypeORM ตั้งด้วยจะมีเจ้าของสองคน
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
