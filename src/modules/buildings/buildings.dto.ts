import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IfPresent } from '../../common/validation/is-defined-if-present';
import { Building } from '../../database/entities';

// ใช้ทั้ง POST และ PUT (PUT = แทนที่ทั้งรายการ จึงต้องส่งครบเหมือนตอนสร้าง)
export class BuildingDto {
  @ApiProperty({ example: 'D1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @ApiProperty({ example: 'หอพักนักศึกษา D1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}

export class PatchBuildingDto {
  @ApiPropertyOptional({ example: 'D1' })
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ example: 'หอพักนักศึกษา D1' })
  @IfPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
}

export class BuildingView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'D1' })
  code: string;

  @ApiProperty({ example: 'หอพักนักศึกษา D1' })
  name: string;
}

export const toBuildingView = (b: Building): BuildingView => ({ id: b.id, code: b.code, name: b.name });
