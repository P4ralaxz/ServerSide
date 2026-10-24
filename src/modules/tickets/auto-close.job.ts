import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Env } from '../../config/env';
import { TicketWorkflowService } from './ticket-workflow.service';

// ตัวตั้งเวลาเท่านั้น — กฎทั้งหมดอยู่ใน closeIfStillDue ตัวเดียวกับที่ Admin กดสั่งรันเอง
@Injectable()
export class AutoCloseJob {
  private readonly logger = new Logger(AutoCloseJob.name);

  constructor(
    private readonly workflow: TicketWorkflowService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ทุก 15 นาที (DESIGN 6.6) · dev ปิดไว้ด้วย AUTO_CLOSE_CRON_ENABLED=false
  // ไม่งั้นใบเดโมที่ seed ไว้ให้กดโชว์จะถูกปิดเองภายในรอบแรกหลัง seed
  @Cron('*/15 * * * *', { name: 'auto-close' })
  async tick(): Promise<void> {
    if (!this.config.get('AUTO_CLOSE_CRON_ENABLED', { infer: true })) return;
    const closed = await this.workflow.closeIfStillDue();
    if (closed.length > 0) this.logger.log(`ปิดอัตโนมัติ ${closed.length} ใบ`);
  }
}
