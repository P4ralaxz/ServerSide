import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { TicketWorkflowService } from './ticket-workflow.service';
import {
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketsDto,
  CreateTicketsResponse,
  HistoryEntryView,
  ListTicketsQuery,
  QueueCountsView,
  RejectTicketDto,
  ReopenTicketDto,
  ScheduleTicketDto,
  SetPriorityDto,
  TicketView,
} from './tickets.dto';

// endpoint แยกตามสิทธิ์ — ห้ามรวมเป็น PUT /tickets/:id (กฎใน CLAUDE.md)
// @Roles() ไม่ต้องเขียน 'admin' ซ้ำ: RolesGuard ยกระดับ admin เป็น staff ที่ actorOf() ที่เดียว (DESIGN 4.2)
@ApiTags('tickets')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly creation: TicketCreationService,
    private readonly query: TicketQueryService,
    private readonly workflow: TicketWorkflowService,
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
  @ApiOperation({ summary: 'รายการใบแจ้งซ่อมที่ตัวเองมองเห็นได้ พร้อม actions ของแต่ละใบ (ทุก role)' })
  @ApiOkResponse({ type: [TicketView] })
  @ApiBadRequestResponse()
  list(@CurrentUser() user: User, @Query() q: ListTicketsQuery): Promise<TicketView[]> {
    return this.query.list(user, q);
  }

  // ต้องประกาศก่อน :id ไม่งั้น "queue-counts" ถูกจับเป็น id แล้วโดน ParseUUIDPipe ตอบ 400
  @Get('queue-counts')
  @Roles('staff')
  @ApiOperation({
    summary: 'ตัวเลขบนตัวกรองคิวของ Staff ในคำขอเดียว (staff, admin)',
    description: 'แต่ละตัวเท่ากับจำนวนรายการของ GET /tickets เมื่อกรองด้วย param ที่คู่กัน',
  })
  @ApiOkResponse({ type: QueueCountsView })
  @ApiForbiddenResponse({ description: 'role ไม่มีสิทธิ์' })
  queueCounts(@CurrentUser() user: User): Promise<QueueCountsView> {
    return this.query.queueCounts(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดใบ — ประวัติอยู่ที่ GET /tickets/:id/history (ทุก role)' })
  @ApiOkResponse({ type: TicketView })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<TicketView> {
    return this.query.detail(user, id);
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'ประวัติของใบ — รวมการเปลี่ยนขั้นและรายการที่ขั้นไม่เปลี่ยน พร้อมเวลาค้างต่อขั้น (ทุก role)',
  })
  @ApiOkResponse({ type: [HistoryEntryView] })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  history(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<HistoryEntryView[]> {
    return this.query.history(user, id);
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

  @Post(':id/assign')
  @Roles('staff')
  @HttpCode(200)
  @ApiOperation({
    summary: 'มอบหมายช่าง / เปลี่ยนตัวช่าง (staff, admin)',
    description:
      'open → assigned เขียน status log + audit assign · ใบที่ assigned อยู่แล้วเปลี่ยนตัวช่าง = audit reassign และล้างนัด · ใบ resolved ต้องไปทาง /reopen → 409',
  })
  @ApiOkResponse({ type: TicketView })
  @ApiBadRequestResponse({ description: 'INVALID_TECHNICIAN — ไม่ใช่ช่าง ถูกระงับ หรือไม่พบ' })
  @ApiForbiddenResponse({ description: 'role ไม่มีสิทธิ์' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION หรือ ALREADY_ASSIGNED' })
  assign(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ): Promise<TicketView> {
    return this.workflow.assign(user, id, dto);
  }

  @Patch(':id/schedule')
  @Roles('technician', 'staff')
  @ApiOperation({
    summary: 'นัดเวลาเข้าซ่อม / เลื่อนนัด — ช่างเจ้าของงานหรือ staff · ไม่ใช่การเปลี่ยนสถานะ',
  })
  @ApiOkResponse({ type: TicketView })
  @ApiBadRequestResponse({ description: 'SCHEDULE_IN_PAST — เวลานัดต้องเป็นอนาคต' })
  @ApiForbiddenResponse({ description: 'ไม่ใช่ช่างเจ้าของงาน' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'NOT_SCHEDULABLE — ใบยังไม่มีช่าง หรือจบแล้ว' })
  schedule(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleTicketDto,
  ): Promise<TicketView> {
    return this.workflow.schedule(user, id, dto);
  }

  @Post(':id/status')
  @Roles('technician')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ช่างเดินสถานะ: in_progress / pending_parts / resolved (technician)',
    description:
      'ช่างไปได้สูงสุด resolved (กฎข้อ 2) · pending_parts บังคับ note · ใบห้องพักที่ไม่อนุญาตให้เข้าห้องต้องมีนัดก่อนเริ่มงาน',
  })
  @ApiOkResponse({ type: TicketView })
  @ApiBadRequestResponse({ description: 'NOTE_REQUIRED — pending_parts ต้องบอกอะไหล่ที่รอ' })
  @ApiForbiddenResponse({ description: 'ไม่ใช่ช่างเจ้าของงาน' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION หรือ APPOINTMENT_REQUIRED' })
  changeStatus(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<TicketView> {
    return this.workflow.changeStatus(user, id, dto);
  }

  @Patch(':id/priority')
  @Roles('staff')
  @ApiOperation({ summary: 'ปรับความด่วน (staff, admin) — ไม่ใช่การเปลี่ยนสถานะ ลง audit log' })
  @ApiOkResponse({ type: TicketView })
  @ApiBadRequestResponse({ description: 'priority ไม่อยู่ในรายการ' })
  @ApiForbiddenResponse({ description: 'role ไม่มีสิทธิ์' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'TICKET_NOT_OPEN หรือ PRIORITY_UNCHANGED' })
  setPriority(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPriorityDto,
  ): Promise<TicketView> {
    return this.workflow.setPriority(user, id, dto);
  }

  @Post(':id/reject')
  @Roles('staff')
  @HttpCode(200)
  @ApiOperation({ summary: 'ไม่รับเรื่อง — ทำได้ตอน open และ assigned · ต้องมีเหตุผล (staff, admin)' })
  @ApiOkResponse({ type: TicketView })
  @ApiBadRequestResponse({ description: 'ไม่มี note' })
  @ApiForbiddenResponse({ description: 'role ไม่มีสิทธิ์' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — ช่างเริ่มงานแล้ว' })
  reject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTicketDto,
  ): Promise<TicketView> {
    return this.workflow.reject(user, id, dto);
  }

  @Post(':id/confirm')
  @Roles('student', 'staff')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ยืนยันว่าซ่อมหายแล้ว — ใบห้องพัก: ผู้พักห้องนั้น · ใบส่วนกลาง: staff (กฎข้อ 2)',
    description: 'Staff/admin ยืนยันใบห้องพักแทนไม่ได้ → 403',
  })
  @ApiOkResponse({ type: TicketView })
  @ApiForbiddenResponse({ description: 'ไม่ใช่ผู้พักห้องนั้น หรือเป็นใบห้องพักที่ Staff ทำแทนไม่ได้' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — ใบยังไม่ resolved หรือปิดแล้ว' })
  confirm(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<TicketView> {
    return this.workflow.confirm(user, id);
  }

  @Post(':id/reopen')
  @Roles('student', 'staff')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ยังไม่หาย — ส่งใบกลับไปหาช่างคนเดิม · ใบห้องพัก: ผู้พักห้องนั้น · ใบส่วนกลาง: staff',
    description:
      'resolved → assigned · ต้องมี note · reopen_count += 1 · ล้าง resolved_at / disputed_at / confirmed_by · เมลแจ้งช่างและ Staff หลัง commit',
  })
  @ApiOkResponse({ type: TicketView })
  @ApiBadRequestResponse({ description: 'ไม่มี note' })
  @ApiForbiddenResponse({ description: 'ไม่ใช่ผู้พักห้องนั้น หรือเป็นใบห้องพักที่ Staff ทำแทนไม่ได้' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — ใบยังไม่ resolved หรือปิดแล้ว' })
  reopen(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenTicketDto,
  ): Promise<TicketView> {
    return this.workflow.reopen(user, id, dto);
  }

  @Post(':id/cancel')
  @Roles('student')
  @HttpCode(200)
  @ApiOperation({ summary: 'ถอนคำแจ้งของตัวเอง — ผู้แจ้งคนนั้นเท่านั้น และเฉพาะตอน open (student)' })
  @ApiOkResponse({ type: TicketView })
  @ApiForbiddenResponse({ description: 'ไม่ใช่ผู้แจ้งใบนี้' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — มีคนรับงานแล้ว ต้องให้ Staff ไม่รับเรื่องแทน' })
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<TicketView> {
    return this.workflow.cancel(user, id);
  }
}
