import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { USER_ROLES, UserRole } from '../../domain/enums';

// ไม่มี password_hash โดยเจตนา — ระบบเป็น passwordless เท่านั้น (กฎข้อ 6)
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'citext' })
  email: string;

  @Column({ name: 'full_name', type: 'text', nullable: true })
  fullName: string | null;

  @Column({ type: 'enum', enum: [...USER_ROLES], enumName: 'user_role', default: 'student' })
  role: UserRole;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
