import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { conflict, notFound } from '../../common/errors/errors';
import { Asset, Building, Room } from '../../database/entities';
import { BuildingDto, PatchBuildingDto } from './buildings.dto';

@Injectable()
export class BuildingsService {
  constructor(private readonly dataSource: DataSource) {}

  list(): Promise<Building[]> {
    return this.dataSource.getRepository(Building).find({ order: { code: 'ASC' } });
  }

  async get(id: string): Promise<Building> {
    const b = await this.dataSource.getRepository(Building).findOne({ where: { id } });
    if (!b) throw notFound('ไม่พบอาคาร');
    return b;
  }

  create(dto: BuildingDto): Promise<Building> {
    const repo = this.dataSource.getRepository(Building);
    return repo.save(repo.create({ code: dto.code, name: dto.name }));
  }

  async update(id: string, dto: BuildingDto | PatchBuildingDto): Promise<Building> {
    const b = await this.get(id);
    if (dto.code !== undefined) b.code = dto.code;
    if (dto.name !== undefined) b.name = dto.name;
    return this.dataSource.getRepository(Building).save(b);
  }

  async remove(id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const b = await m.getRepository(Building).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!b) throw notFound('ไม่พบอาคาร');
      // FK ไม่ช่วยตรงนี้: soft delete เป็นแค่ UPDATE แถวลูกจึงยังชี้มาได้ ต้องเช็คเอง
      const rooms = await m.getRepository(Room).count({ where: { buildingId: id } });
      const assets = await m.getRepository(Asset).count({ where: { buildingId: id } });
      if (rooms + assets > 0) {
        throw conflict('BUILDING_IN_USE', 'ลบไม่ได้ อาคารนี้ยังมีห้องหรือครุภัณฑ์อยู่', { rooms, assets });
      }
      await m.getRepository(Building).softDelete({ id });
    });
  }
}
