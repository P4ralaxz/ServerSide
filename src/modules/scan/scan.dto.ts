import { ApiProperty } from '@nestjs/swagger';
import { TICKET_STATUSES, TicketStatus } from '../../domain/enums';
import { UiAction } from '../../domain/status-rules';
import { BuildingRefView, RoomRefView } from '../tickets/tickets.dto';

export class ScanAssetView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'D1-401-AC' })
  asset_code: string;

  @ApiProperty({ example: 'เครื่องปรับอากาศ' })
  name: string;

  @ApiProperty({ example: 'electrical' })
  category: string;

  @ApiProperty({ type: String, nullable: true, description: 'ใช้กับครุภัณฑ์ส่วนกลาง เช่น "ลิฟต์ฝั่งตะวันออก"' })
  location_note: string | null;

  @ApiProperty({ type: BuildingRefView })
  building: BuildingRefView;

  @ApiProperty({ type: RoomRefView, nullable: true, description: 'NULL = ครุภัณฑ์ส่วนกลาง' })
  room: RoomRefView | null;
}

export class ScanOpenTicketView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'TK-2569-000123' })
  ticket_no: string;

  @ApiProperty({ enum: TICKET_STATUSES })
  status: TicketStatus;

  @ApiProperty()
  updated_at: Date;

  @ApiProperty({ description: 'ผู้ใช้คนนี้แจ้งหรือกดเจอปัญหาเดียวกันไปแล้ว — หน้าจอซ่อนปุ่ม "เจอปัญหาเดียวกัน"' })
  reported_by_me: boolean;

  @ApiProperty({ isArray: true, type: String, description: 'ชุดเดียวกับ actions ของ GET /tickets/:id' })
  actions: UiAction[];
}

export class ScanView {
  @ApiProperty({ type: ScanAssetView })
  asset: ScanAssetView;

  @ApiProperty({
    type: ScanOpenTicketView,
    nullable: true,
    description: 'ใบที่ยังเปิดอยู่ของชิ้นนี้ — NULL เมื่อไม่มี หรือผู้ใช้คนนี้มองไม่เห็นใบนั้น',
  })
  open_ticket: ScanOpenTicketView | null;

  @ApiProperty({
    description:
      'ผลของกฎเดียวกับ POST /tickets — false เมื่อแจ้งชิ้นนี้ไม่ได้ หรือมีใบเปิดอยู่แล้ว (ให้กดเจอปัญหาเดียวกันแทน)',
  })
  can_report: boolean;
}
