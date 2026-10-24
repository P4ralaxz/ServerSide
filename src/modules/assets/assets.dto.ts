import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IfPresent, Nullable } from '../../common/validation/is-defined-if-present';
import { Asset, Ticket } from '../../database/entities';
import { TICKET_STATUSES, TicketStatus } from '../../domain/enums';

// ใช้ทั้ง POST และ PUT
export class AssetDto {
  @ApiProperty({ example: 'D1-401-AC' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  asset_code: string;

  @ApiProperty({ example: 'เครื่องปรับอากาศ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'electrical' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'บังคับเมื่อเป็นครุภัณฑ์ส่วนกลาง · ถ้าระบุ room_id จะใช้อาคารของห้อง',
  })
  @IsOptional()
  @IsUUID()
  building_id?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'ไม่ระบุ / null = ส่วนกลาง' })
  @IsOptional()
  @IsUUID()
  room_id?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'ลิฟต์ฝั่งตะวันออก' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location_note?: string | null;
}

export class PatchAssetDto {
  @ApiPropertyOptional()
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  asset_code?: string;

  @ApiPropertyOptional()
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IfPresent()
  @IsUUID()
  building_id?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null = ย้ายเป็นส่วนกลาง (คงอาคารเดิม)',
  })
  @Nullable()
  @IsUUID()
  room_id?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Nullable()
  @IsString()
  @MaxLength(200)
  location_note?: string | null;
}

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListAssetsQuery {
  @ApiPropertyOptional({ description: 'true = เฉพาะส่วนกลาง · false = เฉพาะในห้องพัก' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  common_area?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  building_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;
}

export class AssetView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  asset_code: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  category: string;

  @ApiProperty({ format: 'uuid' })
  building_id: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  room_id: string | null;

  @ApiProperty({ type: String, nullable: true })
  location_note: string | null;

  @ApiProperty()
  is_common_area: boolean;

  @ApiPropertyOptional({ description: 'ส่งให้เฉพาะ staff / admin' })
  qr_token?: string;
}

// qr_token ส่งให้เฉพาะคนที่พิมพ์สติกเกอร์ได้ — คนอื่นได้มันจากการสแกนของจริงหน้างานเท่านั้น
export const toAssetView = (a: Asset, withQrToken: boolean): AssetView => ({
  id: a.id,
  asset_code: a.assetCode,
  name: a.name,
  category: a.category,
  building_id: a.buildingId,
  room_id: a.roomId,
  location_note: a.locationNote,
  is_common_area: a.roomId === null,
  ...(withQrToken ? { qr_token: a.qrToken } : {}),
});

// ใบที่ยังเปิดอยู่ของครุภัณฑ์ชิ้นนั้น — ส่งเฉพาะใบที่ผู้ขอมองเห็นได้ (canSee) ไม่งั้นเป็น null
export class AssetOpenTicketView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'TK-2569-000123' })
  ticket_no: string;

  @ApiProperty({ enum: TICKET_STATUSES })
  status: TicketStatus;
}

export class AssetListItemView extends AssetView {
  @ApiProperty({
    type: AssetOpenTicketView,
    nullable: true,
    description: 'หน้าแจ้งซ่อมแสดงชิ้นนี้เป็น "แจ้งไว้แล้ว" แทนช่องให้เลือก (DESIGN 7.5)',
  })
  open_ticket: AssetOpenTicketView | null;
}

export const toOpenTicketRef = (t: Ticket | undefined): AssetOpenTicketView | null =>
  t ? { id: t.id, ticket_no: t.ticketNo, status: t.status } : null;
