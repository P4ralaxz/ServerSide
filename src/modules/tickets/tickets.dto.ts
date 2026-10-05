import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Ticket, TicketStatusLog } from '../../database/entities';
import {
  CLOSE_REASONS,
  CloseReason,
  TICKET_PRIORITIES,
  TICKET_SCOPES,
  TICKET_STATUSES,
  TicketPriority,
  TicketScope,
  TicketStatus,
} from '../../domain/enums';
import { MAX_ITEMS_PER_BATCH, TICKET_LIST_DEFAULT_LIMIT, TICKET_LIST_MAX_LIMIT } from '../../domain/limits';

export class CreateTicketItemDto {
  @ApiProperty({ format: 'uuid', description: 'ครุภัณฑ์ที่มีปัญหา — ห้องและอาคารอ่านจากครุภัณฑ์เอง' })
  @IsUUID()
  asset_id: string;

  @ApiProperty({ example: 'แอร์ไม่เย็น' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'มีแต่ลม' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ default: false, description: 'อนุญาตให้ช่างเข้าห้องได้เลย — ใช้กับครุภัณฑ์ในห้องพักเท่านั้น' })
  @IsOptional()
  @IsBoolean()
  permission_to_enter?: boolean;

  @ApiPropertyOptional({ enum: TICKET_SCOPES, description: 'ไม่ต้องส่งก็ได้ — ถ้าส่งต้องตรงกับครุภัณฑ์' })
  @IsOptional()
  @IsIn(TICKET_SCOPES)
  scope?: TicketScope;

  @ApiPropertyOptional({ format: 'uuid', description: 'ไม่ต้องส่งก็ได้ — ถ้าส่งต้องตรงกับห้องของครุภัณฑ์' })
  @IsOptional()
  @IsUUID()
  room_id?: string;
}

export class CreateTicketsDto {
  @ApiProperty({ type: [CreateTicketItemDto], minItems: 1, maxItems: MAX_ITEMS_PER_BATCH })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITEMS_PER_BATCH)
  // ครุภัณฑ์ซ้ำกันเองในคำขอเดียวเป็นความผิดของคำขอ (400) ไม่ใช่การแจ้งซ้ำ (409)
  @ArrayUnique((item: CreateTicketItemDto) => item?.asset_id, { message: 'asset_id ในคำขอเดียวกันต้องไม่ซ้ำกัน' })
  @ValidateNested({ each: true })
  @Type(() => CreateTicketItemDto)
  items: CreateTicketItemDto[];
}

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListTicketsQuery {
  @ApiPropertyOptional({
    enum: TICKET_STATUSES,
    isArray: true,
    description: 'ส่งซ้ำได้หลายค่า: ?status=open&status=assigned',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined || Array.isArray(value) ? value : [value]))
  @IsIn(TICKET_STATUSES, { each: true })
  status?: TicketStatus[];

  @ApiPropertyOptional({ enum: TICKET_SCOPES })
  @IsOptional()
  @IsIn(TICKET_SCOPES)
  scope?: TicketScope;

  @ApiPropertyOptional({ format: 'uuid', description: 'อาคารของครุภัณฑ์' })
  @IsOptional()
  @IsUUID()
  building_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  asset_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  batch_id?: string;

  @ApiPropertyOptional({ description: 'true = เฉพาะใบที่ตัวเองเป็นผู้แจ้ง' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ default: TICKET_LIST_DEFAULT_LIMIT, maximum: TICKET_LIST_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TICKET_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class TicketView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'TK-2569-000123' })
  ticket_no: string;

  @ApiProperty({ format: 'uuid', description: 'ใบที่แจ้งพร้อมกันในคำขอเดียวมีค่าเดียวกัน' })
  batch_id: string;

  @ApiProperty({ format: 'uuid' })
  asset_id: string;

  @ApiProperty({ format: 'uuid', description: 'อาคารของครุภัณฑ์' })
  building_id: string;

  @ApiProperty({ enum: TICKET_SCOPES })
  scope: TicketScope;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  room_id: string | null;

  @ApiProperty({ format: 'uuid' })
  reporter_id: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  assigned_to: string | null;

  @ApiProperty({ enum: TICKET_STATUSES })
  status: TicketStatus;

  @ApiProperty({ enum: TICKET_PRIORITIES })
  priority: TicketPriority;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  report_count: number;

  @ApiProperty()
  reopen_count: number;

  @ApiProperty()
  permission_to_enter: boolean;

  @ApiProperty({ type: Date, nullable: true })
  scheduled_at: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  resolved_at: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  closed_at: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'NULL + auto_closed = ระบบปิดให้' })
  confirmed_by: string | null;

  @ApiProperty({ enum: CLOSE_REASONS, nullable: true })
  close_reason: CloseReason | null;

  @ApiProperty({ type: Date, nullable: true })
  disputed_at: Date | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}

export const toTicketView = (t: Ticket, buildingId: string): TicketView => ({
  id: t.id,
  ticket_no: t.ticketNo,
  batch_id: t.batchId,
  asset_id: t.assetId,
  building_id: buildingId,
  scope: t.scope,
  room_id: t.roomId,
  reporter_id: t.reporterId,
  assigned_to: t.assignedTo,
  status: t.status,
  priority: t.priority,
  title: t.title,
  description: t.description,
  report_count: t.reportCount,
  reopen_count: t.reopenCount,
  permission_to_enter: t.permissionToEnter,
  scheduled_at: t.scheduledAt,
  resolved_at: t.resolvedAt,
  closed_at: t.closedAt,
  confirmed_by: t.confirmedBy,
  close_reason: t.closeReason,
  disputed_at: t.disputedAt,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
});

export class StatusLogView {
  @ApiProperty({ enum: TICKET_STATUSES, nullable: true, description: 'NULL = สร้างใบ' })
  from_status: TicketStatus | null;

  @ApiProperty({ enum: TICKET_STATUSES })
  to_status: TicketStatus;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'NULL = ระบบ' })
  actor_id: string | null;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty()
  created_at: Date;
}

export const toStatusLogView = (l: TicketStatusLog): StatusLogView => ({
  from_status: l.fromStatus,
  to_status: l.toStatus,
  actor_id: l.actorId,
  note: l.note,
  created_at: l.createdAt,
});

export class TicketDetailView extends TicketView {
  @ApiProperty({ type: [StatusLogView], description: 'เรียงตามเวลา — เฉพาะการเปลี่ยนขั้นจริง' })
  status_logs: StatusLogView[];
}

export class SkippedItemView {
  @ApiProperty({ format: 'uuid' })
  asset_id: string;

  @ApiProperty({ example: 'TK-2569-000123', description: 'ใบที่ยังเปิดอยู่ของครุภัณฑ์นี้ — กด same-issue ที่ใบนี้แทน' })
  ticket_no: string;

  @ApiProperty({ format: 'uuid' })
  ticket_id: string;
}

export class CreateTicketsResponse {
  @ApiProperty({ format: 'uuid' })
  batch_id: string;

  @ApiProperty({ type: [TicketView] })
  created: TicketView[];

  @ApiProperty({ type: [SkippedItemView], description: 'รายการที่ครุภัณฑ์มีใบเปิดอยู่แล้ว — เป็น array เสมอ' })
  skipped: SkippedItemView[];
}
