import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../common/auth/decorators';
import { TicketWorkflowService } from '../tickets/ticket-workflow.service';
import { AutoCloseRunView } from '../tickets/tickets.dto';

// มีไว้เพราะตอนนำเสนอรอ 3 วันไม่ได้ (ของเดิมมี POST /jobs/auto-close ด้วยเหตุผลเดียวกัน)
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly workflow: TicketWorkflowService) {}

  @Post('auto-close/run')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'สั่งรัน job ปิดอัตโนมัติทันที (admin)',
    description:
      'เรียก closeIfStillDue ตัวเดียวกับ cron — ปิดเฉพาะใบ resolved ที่เลย AUTO_CLOSE_AFTER_HOURS และไม่มีคนแย้ง ไม่มีพารามิเตอร์ข้ามเงื่อนไข',
  })
  @ApiOkResponse({ type: AutoCloseRunView })
  @ApiForbiddenResponse({ description: 'ไม่ใช่ admin (staff ก็ไม่ได้)' })
  async runAutoClose(): Promise<AutoCloseRunView> {
    const tickets = await this.workflow.closeIfStillDue();
    return { closed_count: tickets.length, tickets };
  }
}
