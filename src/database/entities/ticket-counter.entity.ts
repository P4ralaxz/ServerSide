import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('ticket_counters')
export class TicketCounter {
  @PrimaryColumn({ name: 'be_year', type: 'int' })
  beYear: number;

  @Column({ name: 'last_no', type: 'int' })
  lastNo: number;
}
