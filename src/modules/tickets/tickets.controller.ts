import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { User } from '../../database/entities';
import { TicketCreationService } from './ticket-creation.service';
import { TicketQueryService } from './ticket-query.service';
import { CreateTicketsDto, CreateTicketsResponse, ListTicketsQuery, TicketDetailView, TicketView } from './tickets.dto';

// endpoint แยกตามสิทธิ์ — ห้ามรวมเป็น PUT /tickets/:id (กฎใน CLAUDE.md)
// /assign /schedule /status /priority /reject /confirm /reopen /cancel มาในสัปดาห์ 4–5
@ApiTags('tickets')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly creation: TicketCreationService,
    private readonly query: TicketQueryService,
  ) {}

  @Post()
  @Roles('student', 'staff')
  @ApiOperation({
    summary: 'แจ้งซ่อม 1–10 รายการ — 1 รายการ = 1 ใบ ผูก batch_id เดียวกัน (student, staff)',
    description:
      'ลำดับการตรวจ: role (403) → ownership ต่อรายการ (403 ทั้งคำขอ) → แจ้งซ้ำ. ซ้ำบางรายการ → 201 + skipped[] · ซ้ำทุกรายการ → 409',
  })
  @ApiCreatedResponse({ type: CreateTicketsResponse })
  @ApiBadRequestResponse({
    description: 'items ว่าง / เกิน 10 / asset_id ซ้ำกันเอง / scope หรือ room_id ไม่ตรงกับครุภัณฑ์',
  })
  @ApiForbiddenResponse({ description: 'role ไม่มีสิทธิ์ หรือมีรายการที่ไม่ใช่ห้องของตัวเอง' })
  @ApiNotFoundResponse({ description: 'ไม่พบครุภัณฑ์' })
  @ApiConflictResponse({ description: 'DUPLICATE_OPEN_TICKET — ทุกรายการมีใบเปิดอยู่แล้ว (details.skipped)' })
  @ApiTooManyRequestsResponse({ description: 'QUOTA_EXCEEDED — ใบเปิดของผู้แจ้งเกิน 10 ใบ' })
  create(@CurrentUser() user: User, @Body() dto: CreateTicketsDto): Promise<CreateTicketsResponse> {
    return this.creation.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'รายการใบแจ้งซ่อมที่ตัวเองมองเห็นได้ (ทุก role)' })
  @ApiOkResponse({ type: [TicketView] })
  @ApiBadRequestResponse()
  list(@CurrentUser() user: User, @Query() q: ListTicketsQuery): Promise<TicketView[]> {
    return this.query.list(user, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดใบ + ประวัติการเปลี่ยนขั้น (ทุก role)' })
  @ApiOkResponse({ type: TicketDetailView })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<TicketDetailView> {
    return this.query.detail(user, id);
  }

  @Post(':id/same-issue')
  @Roles('student')
  @HttpCode(200)
  @ApiOperation({ summary: 'เจอปัญหาเดียวกัน — 1 คน 1 ครั้ง · เกิน 10 คนยกเป็น urgent (student)' })
  @ApiOkResponse({ type: TicketView })
  @ApiForbiddenResponse({ description: 'ไม่ใช่ student หรือไม่ได้พักห้องของใบนี้' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'ALREADY_REPORTED หรือ TICKET_NOT_OPEN' })
  sameIssue(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<TicketView> {
    return this.creation.sameIssue(user, id);
  }
}
