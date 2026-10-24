import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import { User } from '../../database/entities';
import { ScanView } from './scan.dto';
import { ScanService } from './scan.service';

// API ที่ต้องมี token — ตัวหน้า /app/scan/:qrToken เปิดได้โดยไม่ต้อง login แต่ไม่มีข้อมูลในตัว (DESIGN 6.8)
// ข้อมูลครุภัณฑ์รั่วไม่ได้ก่อน login ไม่งั้นไล่เดา qr_token ทั้งหอได้
@ApiTags('scan')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token — หน้าเว็บพาไป login แล้วกลับมาที่เดิม' })
@Controller('scan')
export class ScanController {
  constructor(private readonly scans: ScanService) {}

  @Get(':qrToken')
  @ApiOperation({
    summary: 'หน้าแรกหลังสแกน QR — ครุภัณฑ์ ใบที่ยังเปิดอยู่ และแจ้งซ่อมได้ไหม (ทุก role)',
    description: 'open_ticket ส่งเฉพาะใบที่ผู้ขอมองเห็นได้ · can_report ใช้กฎเดียวกับ POST /tickets',
  })
  @ApiOkResponse({ type: ScanView })
  @ApiNotFoundResponse({ description: 'ไม่พบ QR นี้ หรือครุภัณฑ์ถูกลบแล้ว' })
  scan(@CurrentUser() user: User, @Param('qrToken') qrToken: string): Promise<ScanView> {
    return this.scans.scan(user, qrToken);
  }
}
