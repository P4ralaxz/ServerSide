import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { IfPresent } from '../../common/validation/is-defined-if-present';
import { Room } from '../../database/entities';

export const DEFAULT_ROOM_CAPACITY = 2;

// ใช้ทั้ง POST และ PUT — PUT แทนที่ทั้งรายการ: ไม่ส่ง capacity = กลับเป็นค่าเริ่มต้น ไม่ใช่คงค่าเดิม
export class RoomDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  building_id: string;

  @ApiProperty({ example: '401' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  room_no: string;

  @ApiProperty({ example: 4, minimum: 1 })
  @IsInt()
  @Min(1)
  floor: number;

  @ApiPropertyOptional({ default: DEFAULT_ROOM_CAPACITY, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class PatchRoomDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IfPresent()
  @IsUUID()
  building_id?: string;

  @ApiPropertyOptional()
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  room_no?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IfPresent()
  @IsInt()
  @Min(1)
  floor?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IfPresent()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class ListRoomsQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  building_id?: string;
}

export class RoomView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  building_id: string;

  @ApiProperty()
  room_no: string;

  @ApiProperty()
  floor: number;

  @ApiProperty()
  capacity: number;
}

export const toRoomView = (r: Room): RoomView => ({
  id: r.id,
  building_id: r.buildingId,
  room_no: r.roomNo,
  floor: r.floor,
  capacity: r.capacity,
});
