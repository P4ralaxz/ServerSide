import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
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
import { BuildingDto, BuildingView, PatchBuildingDto, toBuildingView } from './buildings.dto';
import { BuildingsService } from './buildings.service';

@ApiTags('buildings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'ไม่มี token หรือ token ใช้ไม่ได้' })
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Get()
  @ApiOperation({ summary: 'รายการอาคาร (ทุก role)' })
  @ApiOkResponse({ type: [BuildingView] })
  async list(): Promise<BuildingView[]> {
    return (await this.buildings.list()).map(toBuildingView);
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูอาคาร (ทุก role)' })
  @ApiOkResponse({ type: BuildingView })
  @ApiNotFoundResponse()
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<BuildingView> {
    return toBuildingView(await this.buildings.get(id));
  }

  @Post()
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'สร้างอาคาร (staff, admin)' })
  @ApiCreatedResponse({ type: BuildingView })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiConflictResponse({ description: 'รหัสอาคารซ้ำ' })
  async create(@Body() dto: BuildingDto): Promise<BuildingView> {
    return toBuildingView(await this.buildings.create(dto));
  }

  @Put(':id')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'แทนที่ข้อมูลอาคารทั้งรายการ (staff, admin)' })
  @ApiOkResponse({ type: BuildingView })
  @ApiBadRequestResponse({ description: 'ส่งฟิลด์ไม่ครบ' })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'รหัสอาคารซ้ำ' })
  async replace(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BuildingDto): Promise<BuildingView> {
    return toBuildingView(await this.buildings.update(id, dto));
  }

  @Patch(':id')
  @Roles('staff', 'admin')
  @ApiOperation({ summary: 'แก้บางฟิลด์ของอาคาร (staff, admin)' })
  @ApiOkResponse({ type: BuildingView })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'รหัสอาคารซ้ำ' })
  async patch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchBuildingDto): Promise<BuildingView> {
    return toBuildingView(await this.buildings.update(id, dto));
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'ลบอาคารแบบ soft delete (admin)' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'ยังมีห้องหรือครุภัณฑ์อยู่ในอาคาร' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.buildings.remove(id);
  }
}
