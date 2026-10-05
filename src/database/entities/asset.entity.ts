import { Column, DeleteDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'asset_code', type: 'text' })
  assetCode: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  category: string;

  @Column({ name: 'building_id', type: 'uuid' })
  buildingId: string;

  // NULL = ครุภัณฑ์ส่วนกลาง
  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'location_note', type: 'text', nullable: true })
  locationNote: string | null;

  @Column({ name: 'qr_token', type: 'text' })
  qrToken: string;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
