import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IfPresent, Nullable } from '../../common/validation/is-defined-if-present';
import { IsUniversityEmail } from '../../common/validation/university-email';
import { USER_ROLES, UserRole } from '../../domain/enums';

export class CreateUserDto {
  @ApiProperty({ example: 'tech.air@kmitl.ac.th' })
  @IsUniversityEmail()
  email: string;

  @ApiPropertyOptional({ enum: USER_ROLES, default: 'student' })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  full_name?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'ช่างผูกห้องไม่ได้' })
  @IsOptional()
  @IsUUID()
  room_id?: string | null;
}

// ฟิลด์ที่ไม่ได้ส่งมา = ไม่แตะ · สิทธิ์ต่อฟิลด์ตรวจใน UsersService (admin ทุกฟิลด์ · staff เฉพาะ room_id)
export class UpdateUserDto {
  @ApiPropertyOptional({ enum: USER_ROLES, description: 'admin เท่านั้น' })
  @IfPresent()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'admin เท่านั้น — false = ระงับบัญชี มีผลกับ token เดิมทันที' })
  @IfPresent()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'admin เท่านั้น' })
  @Nullable()
  @IsString()
  @MaxLength(200)
  full_name?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'staff / admin — null = ย้ายออกจากห้อง',
  })
  @Nullable()
  @IsUUID()
  room_id?: string | null;
}

export class ListUsersQuery {
  @ApiPropertyOptional({ enum: USER_ROLES })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'ค้นบางส่วนของอีเมล' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  is_active?: boolean;
}
