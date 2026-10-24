import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { Env } from '../../config/env';
import { User } from '../../database/entities';
import { TicketPolicy } from '../tickets/ticket-policy.service';
import { TicketQueryService } from '../tickets/ticket-query.service';
import {
  AssetDto,
  AssetListItemView,
  AssetView,
  ListAssetsQuery,
  PatchAssetDto,
  toAssetView,
  toOpenTicketRef,
} from './assets.dto';
import { qrPng, scanUrl } from './asset-qr';
import { AssetsService } from './assets.service';

const seesQrToken = (user: User): boolean => user.role === 'staff' || user.role === 'admin';

@ApiTags('assets')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly tickets: TicketQueryService,
    private readonly policy: TicketPolicy,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'รายการครุภัณฑ์ พร้อมใบที่ยังเปิดอยู่ของแต่ละชิ้น (ทุก role)',
    description: 'open_ticket ส่งเฉพาะใบที่ผู้ขอมองเห็นได้ · นักศึกษาขอ room_id ของห้องอื่น → 403',
  })
  @ApiOkResponse({ type: [AssetListItemView] })
  @ApiForbiddenResponse({ description: 'นักศึกษาขอรายการของห้องอื่น' })
  async list(@CurrentUser() user: User, @Query() q: ListAssetsQuery): Promise<AssetListItemView[]> {
    if (q.room_id) this.policy.assertCanBrowseRoom(user, q.room_id);
    const assets = await this.assets.list(q);
    // ใบเปิดของทุกชิ้นในคำสั่งเดียว — ไม่ถามทีละชิ้น (DESIGN 7.5)
    const { visible } = await this.tickets.openTicketsOf(
      user,
      assets.map((a) => a.id),
    );
    return assets.map((a) => ({
      ...toAssetView(a, seesQrToken(user)),
      open_ticket: toOpenTicketRef(visible.get(a.id)),
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูครุภัณฑ์ (ทุก role)' })
  @ApiOkResponse({ type: AssetView })
  @ApiNotFoundResponse()
  async get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<AssetView> {
    return toAssetView(await this.assets.get(id), seesQrToken(user));
  }

  @Get(':id/qr')
  @Roles('staff')
  @ApiOperation({
    summary: 'รูป QR สำหรับพิมพ์ติดครุภัณฑ์ — ลิงก์ไปหน้าสแกน /app/scan/:qrToken (staff, admin)',
    description: 'ลิงก์ที่อยู่ใน QR ส่งกลับใน header X-Scan-Url ด้วย',
  })
  @ApiProduces('image/png')
  @ApiOkResponse({ description: 'PNG', schema: { type: 'string', format: 'binary' } })
  @ApiForbiddenResponse({ description: 'พิมพ์สติกเกอร์เป็นงานของเจ้าหน้าที่' })
  @ApiNotFoundResponse({
    description: 'ไม่พบครุภัณฑ์ หรือถูกลบแล้ว — กันพิมพ์สติกเกอร์ที่สแกนแล้วเจอ 404 ไปติดหน้างาน',
  })
  async qr(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const asset = await this.assets.get(id);
    const url = scanUrl(this.config.get('APP_BASE_URL', { infer: true }), asset.qrToken);
    res.setHeader('X-Scan-Url', url);
    return new StreamableFile(await qrPng(url), { type: 'image/png' });
  }

  @Post()
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'สร้างครุภัณฑ์ — ระบบสุ่ม qr_token ให้ (staff, admin)' })
  @ApiCreatedResponse({ type: AssetView })
  @ApiBadRequestResponse({ description: 'ส่วนกลางไม่ระบุอาคาร / ไม่พบห้องหรืออาคาร / อาคารไม่ตรงกับห้อง' })
  @ApiForbiddenResponse()
  @ApiConflictResponse({ description: 'รหัสครุภัณฑ์ซ้ำ' })
  async create(@Body() dto: AssetDto): Promise<AssetView> {
    return toAssetView(await this.assets.create(dto), true);
  }

  @Put(':id')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'แทนที่ข้อมูลครุภัณฑ์ทั้งรายการ (staff, admin)' })
  @ApiOkResponse({ type: AssetView })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'รหัสครุภัณฑ์ซ้ำ' })
  async replace(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssetDto): Promise<AssetView> {
    return toAssetView(await this.assets.replace(id, dto), true);
  }

  @Patch(':id')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'แก้บางฟิลด์ของครุภัณฑ์ — room_id: null = ย้ายเป็นส่วนกลาง (staff, admin)' })
  @ApiOkResponse({ type: AssetView })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'รหัสครุภัณฑ์ซ้ำ' })
  async patch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchAssetDto): Promise<AssetView> {
    return toAssetView(await this.assets.patch(id, dto), true);
  }

  @Delete(':id')
  @Roles('staff', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'ลบครุภัณฑ์แบบ soft delete (staff, admin)' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'ยังมีใบแจ้งซ่อมที่ยังไม่ปิด (details.tickets)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.assets.remove(id);
  }
}
