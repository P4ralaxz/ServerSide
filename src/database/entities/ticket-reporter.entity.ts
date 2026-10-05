import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// PK คู่ (ticket_id, user_id) = 1 คนนับได้ครั้งเดียว กัน report_count เฟ้อ
@Entity('ticket_reporters')
export class TicketReporter {
  @PrimaryColumn({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
