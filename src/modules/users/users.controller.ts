import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { User } from '../../database/entities';
import { toUserView, UserView } from './user.view';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@ApiForbiddenResponse({ description: 'role ไม่มีสิทธิ์' })
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'รายชื่อผู้ใช้ (admin)' })
  @ApiOkResponse({ type: [UserView] })
  async list(@Query() q: ListUsersQuery): Promise<UserView[]> {
    return (await this.users.list(q)).map(toUserView);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'สร้างบัญชีล่วงหน้า เช่น ช่าง / Staff (admin)' })
  @ApiCreatedResponse({ type: UserView })
  @ApiBadRequestResponse({ description: 'อีเมลนอกมหาวิทยาลัย หรือผูกห้องให้ช่าง' })
  @ApiConflictResponse({ description: 'อีเมลซ้ำ หรือห้องเต็ม' })
  async create(@Body() dto: CreateUserDto): Promise<UserView> {
    return toUserView(await this.users.create(dto));
  }

  @Patch(':id')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'แก้ผู้ใช้ — admin: role, is_active, full_name, room_id · staff: room_id เท่านั้น' })
  @ApiOkResponse({ type: UserView })
  @ApiBadRequestResponse({ description: 'ผูกห้องให้ช่าง, ห้องไม่มีอยู่, หรือแก้ role/ระงับบัญชีตัวเอง' })
  @ApiForbiddenResponse({ description: 'staff ส่งฟิลด์อื่นนอกจาก room_id' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'ห้องเต็ม หรือช่างยังมีใบค้าง (details.tickets)' })
  async update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserView> {
    return toUserView(await this.users.update(actor, id, dto));
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'ลบผู้ใช้แบบ soft delete (admin)' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'ลบบัญชีตัวเอง' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'ช่างยังมีใบค้าง (details.tickets)' })
  remove(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.users.remove(actor, id);
  }
}
