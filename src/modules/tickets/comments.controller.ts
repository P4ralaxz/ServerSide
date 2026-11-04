import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import { User } from '../../database/entities';
import { TicketCommentService } from './ticket-comment.service';
import { CommentView, CreateCommentDto } from './tickets.dto';

// ทุก role เรียกได้ (ไม่มี @Roles) — สิทธิ์จริงอยู่ที่ TicketPolicy: เห็นใบได้ไหม แล้วเป็นคนที่เกี่ยวกับใบไหม
@ApiTags('tickets')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@Controller('tickets/:id/comments')
export class CommentsController {
  constructor(private readonly comments: TicketCommentService) {}

  @Get()
  @ApiOperation({ summary: 'ความเห็นในใบ เรียงเก่าไปใหม่ — นักศึกษาไม่ได้รับความเห็นภายใน (ทุก role)' })
  @ApiOkResponse({ type: [CommentView] })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  list(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<CommentView[]> {
    return this.comments.list(user, id);
  }

  @Post()
  @ApiOperation({
    summary: 'เขียนความเห็น (ผู้พักห้องนั้น / นักศึกษาทุกคนสำหรับใบส่วนกลาง, ช่างเจ้าของงาน, staff, admin)',
    description: 'ลำดับการตรวจ: มองไม่เห็นใบ (404) → ไม่ใช่คนที่เกี่ยวกับใบ (403) → นักศึกษาส่ง is_internal (403)',
  })
  @ApiCreatedResponse({ type: CommentView })
  @ApiBadRequestResponse({ description: 'body ว่างหรือยาวเกิน 2000 ตัวอักษร' })
  @ApiForbiddenResponse({ description: 'ไม่ใช่คนที่เกี่ยวกับใบ หรือนักศึกษาส่ง is_internal = true' })
  @ApiNotFoundResponse({ description: 'ไม่พบ หรือมองไม่เห็นใบนี้' })
  create(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentView> {
    return this.comments.create(user, id, dto);
  }
}
