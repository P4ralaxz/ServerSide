import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'ตรวจว่าแอปและฐานข้อมูลพร้อมใช้งาน' })
  @ApiOkResponse({ schema: { example: { status: 'ok', db: 'up' } } })
  @ApiServiceUnavailableResponse({ description: 'ต่อฐานข้อมูลไม่ได้' })
  async check(): Promise<{ status: 'ok'; db: 'up' }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('ต่อฐานข้อมูลไม่ได้');
    }
    return { status: 'ok', db: 'up' };
  }
}
