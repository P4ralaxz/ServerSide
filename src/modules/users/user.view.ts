import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../database/entities';
import { USER_ROLES, UserRole } from '../../domain/enums';

// รูปร่างของ user ที่ส่งออกทาง API (snake_case ตาม DESIGN) — ใช้ร่วมกันทั้ง /auth และ /users
export class UserView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '66070001@kmitl.ac.th' })
  email: string;

  @ApiProperty({ type: String, nullable: true })
  full_name: string | null;

  @ApiProperty({ enum: USER_ROLES })
  role: UserRole;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'NULL = ยังไม่ถูกผูกห้อง' })
  room_id: string | null;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty()
  created_at: Date;
}

export const toUserView = (u: User): UserView => ({
  id: u.id,
  email: u.email,
  full_name: u.fullName,
  role: u.role,
  room_id: u.roomId,
  is_active: u.isActive,
  created_at: u.createdAt,
});
