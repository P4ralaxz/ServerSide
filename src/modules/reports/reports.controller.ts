import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../common/auth/decorators';
import { ReportQuery, SlaSummaryView, StageDurationRow, SummaryQuery, TechnicianReportRow } from './reports.dto';
import { ReportsService } from './reports.service';

// ตัวเลขภาพรวมของหอและสถิติรายบุคคลของช่าง — staff / admin เท่านั้น
// @Roles('staff') ครอบ admin ด้วย (admin ⊇ staff ที่ RolesGuard)
@ApiTags('reports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@ApiForbiddenResponse({ description: 'นักศึกษาและช่างดูรายงานไม่ได้' })
@ApiBadRequestResponse({ description: 'ตัวกรองผิดรูปแบบ' })
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sla-summary')
  @Roles('staff')
  @ApiOperation({
    summary: 'สรุปเวลาซ่อม การปิดงาน และการส่งกลับ จัดกลุ่มตามอาคาร / หมวด / ช่าง / เดือน (staff, admin)',
    description:
      'เวลาซ่อม = เวลาที่อยู่ใน open + assigned + in_progress ก่อน resolve ล่าสุด (ไม่นับรออะไหล่และรอยืนยัน) · เดือนและวันคิดตามเวลาไทย',
  })
  @ApiOkResponse({ type: SlaSummaryView })
  slaSummary(@Query() q: SummaryQuery): Promise<SlaSummaryView> {
    return this.reports.slaSummary(q);
  }

  @Get('stage-durations')
  @Roles('staff')
  @ApiOperation({
    summary: 'เวลาที่ใบค้างในแต่ละขั้น — ขั้นที่ผ่านไปแล้ว และใบที่ค้างอยู่ตอนนี้ (staff, admin)',
    description: 'ไม่รวมขั้นปลายทาง (closed / rejected / cancelled)',
  })
  @ApiOkResponse({ type: [StageDurationRow] })
  stageDurations(@Query() q: ReportQuery): Promise<StageDurationRow[]> {
    return this.reports.stageDurations(q);
  }

  @Get('technicians')
  @Roles('staff')
  @ApiOperation({
    summary: 'งานของช่างแต่ละคน: งานในมือ ซ่อมเสร็จ เวลาซ่อม และจำนวนครั้งที่ถูกส่งกลับ (staff, admin)',
  })
  @ApiOkResponse({ type: [TechnicianReportRow] })
  technicians(@Query() q: ReportQuery): Promise<TechnicianReportRow[]> {
    return this.reports.technicians(q);
  }
}
