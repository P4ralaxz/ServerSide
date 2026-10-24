import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
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
import {
  AUDIT_ACTIONS,
  AuditAction,
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
import { UiAction } from '../../domain/status-rules';

export class CreateTicketItemDto {
  @ApiProperty({ format: 'uuid', description: 'ครุภัณฑ์ที่มีปัญหา — ห้องและอาคารอ่านจากครุภัณฑ์เอง' })
  @IsUUID()
  asset_id: string;

  @ApiProperty({ example: 'แอร์ไม่เย็น' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  // บังคับที่ API ด้วย ไม่ใช่แค่ในฟอร์ม (DESIGN 7.7, 12.3 ข้อ 9): ใบที่ไม่มีอาการช่างเตรียมของไม่ได้
  // และคนยิง API ตรงต้องสร้างใบแบบนั้นไม่ได้เหมือนกัน · หน้าจอส่งชื่อครุภัณฑ์เป็น title และอาการเป็น description
  @ApiProperty({ example: 'มีแต่ลม', description: 'อาการ — บังคับ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

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

export class AssignTicketDto {
  @ApiProperty({ format: 'uuid', description: 'ช่างที่จะรับงาน — ต้องเป็น technician ที่ยังใช้งานอยู่' })
  @IsUUID()
  technician_id: string;
}

export class ScheduleTicketDto {
  @ApiProperty({ example: '2569-10-20T07:00:00.000Z', description: 'เวลานัดเข้าซ่อม ต้องเป็นเวลาในอนาคต' })
  @IsDateString()
  scheduled_at: string;
}

export class ChangeStatusDto {
  // รับทุกค่าใน ENUM โดยเจตนา: ปลายทางที่ /status ไปไม่ได้ต้องตอบ 409 ตามตารางหัวข้อ 7 ไม่ใช่ 400
  // ถ้า whitelist 4 ปลายทางที่นี่ จะกลายเป็น 400 และเทสเดิมของ status flow จะผิดความหมาย (DESIGN 6.9)
  @ApiProperty({ enum: TICKET_STATUSES, description: 'ช่างไปได้แค่ in_progress / pending_parts / resolved' })
  @IsIn(TICKET_STATUSES)
  to: TicketStatus;

  @ApiPropertyOptional({ description: 'บังคับเมื่อไป pending_parts (อะไหล่ที่รอ)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note?: string;
}

export class SetPriorityDto {
  @ApiProperty({ enum: TICKET_PRIORITIES })
  @IsIn(TICKET_PRIORITIES)
  priority: TicketPriority;
}

export class RejectTicketDto {
  @ApiProperty({ description: 'เหตุผลที่ไม่รับเรื่อง — บังคับ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;
}

export class ReopenTicketDto {
  // บังคับที่ DTO ไม่ใช่ที่ NOTE_REQUIRED: ปลายทาง assigned มาได้จาก /assign ด้วย ซึ่งไม่ต้องมี note
  @ApiProperty({ description: 'อาการที่ยังเป็นอยู่ — บังคับ ช่างจะได้รู้ว่าต้องแก้ตรงไหน' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;
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

  // --- ตัวกรองคิวของ Staff (DESIGN 7.6) — ตัวเลขของแต่ละตัวอยู่ที่ GET /tickets/queue-counts ---

  @ApiPropertyOptional({ enum: TICKET_PRIORITIES, description: 'นับเฉพาะใบที่ยังเปิดอยู่ (OPEN_STATUSES)' })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'true = ใบ resolved ที่มีคนแย้งว่ายังไม่หาย (job ไม่ปิดให้)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  disputed?: boolean;

  @ApiPropertyOptional({ description: 'true = ใบที่เคยถูกส่งกลับ (reopen_count > 0) และยังเปิดอยู่' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  reopened?: boolean;

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

export class UserRefView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, description: 'NULL = ยังไม่กรอกชื่อ' })
  name: string | null;
}

export class AssetRefView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'B412-EL-01' })
  asset_code: string;

  @ApiProperty({ example: 'หลอดไฟเพดาน' })
  name: string;

  @ApiProperty({ example: 'electrical' })
  category: string;
}

export class RoomRefView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'B-412' })
  room_no: string;
}

export class BuildingRefView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'อาคาร B' })
  name: string;
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

  // --- field ที่หน้าจอต้องใช้ (DESIGN 7.2) — มาจาก join ชุดเดียว ไม่ query ต่อแถว ---

  @ApiProperty({ type: AssetRefView, description: 'ชื่อและรหัสครุภัณฑ์ — title เป็นข้อความที่ผู้แจ้งพิมพ์เอง' })
  asset: AssetRefView;

  @ApiProperty({ type: RoomRefView, nullable: true, description: 'NULL = ใบส่วนกลาง' })
  room: RoomRefView | null;

  @ApiProperty({ type: BuildingRefView })
  building: BuildingRefView;

  @ApiProperty({ type: UserRefView, nullable: true })
  assignee: UserRefView | null;

  @ApiProperty({ type: String, nullable: true, description: 'เหตุผลที่ผู้พักส่งกลับครั้งล่าสุด' })
  last_reopen_note: string | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'resolved และยังไม่มีคนแย้ง = เวลาที่ระบบจะปิดให้ · กรณีอื่น NULL',
  })
  auto_close_at: Date | null;

  @ApiProperty({
    isArray: true,
    type: String,
    description: 'ปุ่มที่ผู้ใช้คนนี้กดกับใบนี้ได้ตอนนี้ — หน้าจอแสดงปุ่มจากค่านี้เท่านั้น',
  })
  actions: UiAction[];
}

export class HistoryEntryView {
  @ApiProperty({ enum: ['status', 'audit'], description: 'status = เปลี่ยนขั้นจริง · audit = ไม่เปลี่ยนขั้น' })
  kind: 'status' | 'audit';

  @ApiProperty()
  at: Date;

  @ApiProperty({ type: UserRefView, nullable: true, description: 'NULL = ระบบ' })
  actor: UserRefView | null;

  @ApiPropertyOptional({ enum: TICKET_STATUSES, nullable: true, description: 'NULL = สร้างใบ (เฉพาะ kind=status)' })
  from_status?: TicketStatus | null;

  @ApiPropertyOptional({ enum: TICKET_STATUSES, description: 'เฉพาะ kind=status' })
  to_status?: TicketStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  note?: string | null;

  @ApiPropertyOptional({
    type: Number,
    description: 'เฉพาะ kind=status — เวลาที่ค้างในขั้นนี้จนถึงการเปลี่ยนถัดไป หรือถึงตอนนี้',
  })
  duration_seconds?: number;

  @ApiPropertyOptional({ enum: AUDIT_ACTIONS, description: 'เฉพาะ kind=audit' })
  action?: AuditAction;

  @ApiPropertyOptional({ type: Object, description: 'เฉพาะ kind=audit' })
  detail?: Record<string, unknown>;
}

// ตัวเลขบนชิปของคิว Staff — ทุกตัวเท่ากับจำนวนรายการของ GET /tickets ด้วย param ที่เขียนกำกับไว้
export class QueueCountsView {
  @ApiProperty({ description: 'ใบที่ยังเปิดอยู่ทั้งหมด (status = OPEN_STATUSES)' })
  open_total: number;

  @ApiProperty({ description: 'รอมอบหมาย (status=open)' })
  unassigned: number;

  @ApiProperty({ description: 'ด่วนมาก (priority=urgent)' })
  urgent: number;

  @ApiProperty({ description: 'มีคนแย้งว่ายังไม่หาย (disputed=true)' })
  disputed: number;

  @ApiProperty({ description: 'ถูกส่งกลับ (reopened=true)' })
  reopened: number;

  @ApiProperty({ description: 'ส่วนกลางรอ Staff ยืนยัน (scope=common_area&status=resolved)' })
  common_pending_confirm: number;
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

// ผลของ job ปิดอัตโนมัติต่อใบ — confirmed_by = NULL + auto_closed คือหลักฐานว่าระบบปิด ไม่ใช่คนยืนยัน
export class AutoClosedTicket {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'TK-2569-000123' })
  ticket_no: string;

  @ApiProperty({ enum: TICKET_STATUSES })
  status: TicketStatus;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  confirmed_by: string | null;

  @ApiProperty({ enum: CLOSE_REASONS, nullable: true })
  close_reason: CloseReason | null;
}

export class AutoCloseRunView {
  @ApiProperty()
  closed_count: number;

  @ApiProperty({ type: [AutoClosedTicket] })
  tickets: AutoClosedTicket[];
}
