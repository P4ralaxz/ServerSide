import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
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
import { Roles } from '../../common/auth/decorators';
import { ListRoomsQuery, PatchRoomDto, RoomDto, RoomView, toRoomView } from './rooms.dto';
import { RoomsService } from './rooms.service';

@ApiTags('rooms')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @ApiOperation({ summary: 'รายการห้องพัก (ทุก role)' })
  @ApiOkResponse({ type: [RoomView] })
  async list(@Query() q: ListRoomsQuery): Promise<RoomView[]> {
    return (await this.rooms.list(q)).map(toRoomView);
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูห้องพัก (ทุก role)' })
  @ApiOkResponse({ type: RoomView })
  @ApiNotFoundResponse()
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<RoomView> {
    return toRoomView(await this.rooms.get(id));
  }

  @Post()
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'สร้างห้องพัก (staff, admin)' })
  @ApiCreatedResponse({ type: RoomView })
  @ApiBadRequestResponse({ description: 'ข้อมูลไม่ครบ / floor หรือ capacity ไม่เป็นบวก / ไม่พบอาคาร' })
  @ApiForbiddenResponse()
  @ApiConflictResponse({ description: 'เลขห้องซ้ำในอาคารเดียวกัน' })
  async create(@Body() dto: RoomDto): Promise<RoomView> {
    return toRoomView(await this.rooms.create(dto));
  }

  @Put(':id')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'แทนที่ข้อมูลห้องทั้งรายการ — ไม่ส่ง capacity = กลับเป็นค่าเริ่มต้น (staff, admin)' })
  @ApiOkResponse({ type: RoomView })
  @ApiBadRequestResponse({ description: 'ส่งฟิลด์ไม่ครบ' })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'เลขห้องซ้ำ หรือ capacity ต่ำกว่าจำนวนผู้พัก' })
  async replace(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RoomDto): Promise<RoomView> {
    return toRoomView(await this.rooms.replace(id, dto));
  }

  @Patch(':id')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'แก้บางฟิลด์ของห้อง (staff, admin)' })
  @ApiOkResponse({ type: RoomView })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'เลขห้องซ้ำ หรือ capacity ต่ำกว่าจำนวนผู้พัก' })
  async patch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchRoomDto): Promise<RoomView> {
    return toRoomView(await this.rooms.patch(id, dto));
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'ลบห้องแบบ soft delete (admin)' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'ยังมีผู้พักหรือครุภัณฑ์อยู่ในห้อง' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.rooms.remove(id);
  }
}
