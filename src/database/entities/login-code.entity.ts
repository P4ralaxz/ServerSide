import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('login_codes')
export class LoginCode {
  // bigserial — node-postgres คืน int8 เป็น string
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'citext' })
  email: string;

  @Column({ name: 'code_hash', type: 'text' })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'requested_ip', type: 'inet', nullable: true })
  requestedIp: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
