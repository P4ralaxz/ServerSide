import { Column, DeleteDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'building_id', type: 'uuid' })
  buildingId: string;

  @Column({ name: 'room_no', type: 'text' })
  roomNo: string;

  @Column({ type: 'int' })
  floor: number;

  @Column({ type: 'int' })
  capacity: number;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
