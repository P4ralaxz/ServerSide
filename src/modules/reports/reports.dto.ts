import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { TICKET_STATUSES, TicketStatus } from '../../domain/enums';
import { BuildingRefView, UserRefView } from '../tickets/tickets.dto';

// มิติการจัดกลุ่ม (DESIGN 9.1) — อาคาร/หมวดมาจากครุภัณฑ์ (tickets ไม่มีของตัวเอง) · เดือนคิดตามเวลาไทย
export const REPORT_DIMENSIONS = ['building', 'category', 'technician', 'month'] as const;
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

const THAI_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ตัวกรองชุดเดียวกันทุกรายงาน ตัวเลขข้ามรายงานจึงเทียบกันได้ตรง ๆ
export class ReportQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'อาคารของครุภัณฑ์' })
  @IsOptional()
  @IsUUID()
  building_id?: string;

  @ApiPropertyOptional({ example: 'electrical', description: 'หมวดของครุภัณฑ์' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'ช่างที่รับงานอยู่ (assigned_to)' })
  @IsOptional()
  @IsUUID()
  technician_id?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'ใบที่แจ้งตั้งแต่วันนี้ (วันตามเวลาไทย, ค.ศ. YYYY-MM-DD)',
  })
  @IsOptional()
  @Matches(THAI_DATE, { message: 'from ต้องเป็นวันที่ YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'ใบที่แจ้งถึงสิ้นวันนี้ (วันตามเวลาไทย, ค.ศ. YYYY-MM-DD)',
  })
  @IsOptional()
  @Matches(THAI_DATE, { message: 'to ต้องเป็นวันที่ YYYY-MM-DD' })
  to?: string;
}

export class SummaryQuery extends ReportQuery {
  @ApiPropertyOptional({
    enum: REPORT_DIMENSIONS,
    isArray: true,
    default: ['building', 'category'],
    description: 'ส่งซ้ำได้หลายค่า: ?group_by=building&group_by=month',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined || Array.isArray(value) ? value : [value]))
  @IsIn(REPORT_DIMENSIONS, { each: true })
  @ArrayUnique()
  group_by?: ReportDimension[];
}

export class ReportMetrics {
  @ApiProperty()
  total_tickets: number;

  @ApiProperty({ description: 'ยังเปิดอยู่ (OPEN_STATUSES)' })
  open_tickets: number;

  @ApiProperty()
  closed_tickets: number;

  @ApiProperty({ description: 'Staff ไม่รับเรื่อง — แยกช่องจาก cancelled' })
  rejected_tickets: number;

  @ApiProperty({ description: 'ผู้แจ้งถอนเอง' })
  cancelled_tickets: number;

  @ApiProperty({ description: 'close_reason = user_confirmed' })
  user_confirmed: number;

  @ApiProperty({ description: 'close_reason = staff_confirmed' })
  staff_confirmed: number;

  @ApiProperty({ description: 'close_reason = auto_closed — ระบบปิดให้ ไม่ใช่คนยืนยัน' })
  auto_closed: number;

  @ApiProperty({ description: 'Staff ปิดทั้งที่ยังมีคนแย้งว่ายังไม่หาย (disputed_at ไม่ถูกล้างตอน confirm)' })
  closed_while_disputed: number;

  @ApiProperty({ description: 'ใบที่เคยถูกส่งกลับอย่างน้อยครั้งหนึ่ง' })
  reopened_tickets: number;

  @ApiProperty({ description: 'จำนวนครั้งที่ถูกส่งกลับรวม' })
  reopen_total: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'เวลาซ่อมมัธยฐาน (ชม.) ของใบที่ซ่อมเสร็จแล้ว — ไม่นับรออะไหล่และรอยืนยัน',
  })
  median_repair_hours: number | null;

  @ApiProperty({ type: Number, nullable: true })
  avg_repair_hours: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'เวลารอยืนยันเฉลี่ย (closed_at − resolved_at)' })
  avg_confirm_hours: number | null;

  @ApiProperty({ description: 'ซ่อมเสร็จแล้วแต่เวลาซ่อมเกินเป้าของ priority (SLA_TARGET_HOURS)' })
  over_sla: number;

  @ApiProperty({ description: 'ยังไม่ซ่อมเสร็จ และเวลาที่ผ่านไปเกินเป้าแล้ว' })
  overdue_open: number;
}

export class SummaryRow extends ReportMetrics {
  @ApiPropertyOptional({ type: BuildingRefView })
  building?: BuildingRefView;

  @ApiPropertyOptional({ example: 'electrical' })
  category?: string;

  @ApiPropertyOptional({ type: UserRefView, nullable: true, description: 'NULL = ใบที่ยังไม่มีช่าง' })
  technician?: UserRefView | null;

  @ApiPropertyOptional({ example: '2026-10', description: 'เดือนที่แจ้ง ตามเวลาไทย (ค.ศ.)' })
  month?: string;
}

export class SlaSummaryView {
  @ApiProperty({ enum: REPORT_DIMENSIONS, isArray: true })
  group_by: ReportDimension[];

  @ApiProperty({ type: [SummaryRow] })
  rows: SummaryRow[];

  @ApiProperty({ type: ReportMetrics })
  total: ReportMetrics;
}

export class StageDurationRow {
  @ApiProperty({ enum: TICKET_STATUSES })
  stage: TicketStatus;

  @ApiProperty({ description: 'false = ขั้นนี้ไม่นับเข้าเวลาซ่อม (pending_parts, resolved)' })
  counted_in_sla: boolean;

  @ApiProperty({ description: 'จำนวนครั้งที่ใบผ่านขั้นนี้ไปแล้ว' })
  completed_count: number;

  @ApiProperty({ type: Number, nullable: true })
  avg_hours: number | null;

  @ApiProperty({ type: Number, nullable: true })
  median_hours: number | null;

  @ApiProperty({ description: 'ใบที่ค้างอยู่ในขั้นนี้ตอนนี้' })
  waiting_now: number;

  @ApiProperty({ type: Number, nullable: true })
  max_waiting_hours: number | null;
}

export class TechnicianReportRow {
  @ApiProperty({ type: UserRefView })
  technician: UserRefView;

  @ApiProperty({ description: 'งานในมือ: assigned / in_progress / pending_parts' })
  in_hand: number;

  @ApiProperty({ description: 'จำนวนครั้งที่ช่างคนนี้กดซ่อมเสร็จ' })
  resolved_total: number;

  @ApiProperty({ description: 'ใบของช่างคนนี้ที่ปิดแล้ว' })
  closed_total: number;

  @ApiProperty({ description: 'งานที่ช่างคนนี้กดซ่อมเสร็จแล้วถูกส่งกลับ — สัญญาณคุณภาพงาน' })
  reopen_total: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'เวลาเฉลี่ยจากที่ได้รับงานถึงกดซ่อมเสร็จ (ชม.) ไม่นับรออะไหล่ — เวลาที่ใบรอมอบหมายไม่ใช่ของช่าง',
  })
  avg_hours_to_resolve: number | null;

  @ApiProperty({ type: Number, nullable: true })
  median_hours_to_resolve: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'เวลาซ่อมมัธยฐาน (นิยามเดียวกับ sla-summary)' })
  median_sla_hours: number | null;

  @ApiProperty({ description: 'ใบของช่างคนนี้ที่ซ่อมเสร็จแต่เกินเป้า SLA' })
  late_resolved: number;
}
