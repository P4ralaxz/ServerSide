import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { Asset, Building, Room } from '../../database/entities';
import { OPEN_STATUSES } from '../../domain/status-rules';
import { AssetDto, ListAssetsQuery, PatchAssetDto } from './assets.dto';

interface Location {
  buildingId: string;
  roomId: string | null;
}

@Injectable()
export class AssetsService {
  constructor(private readonly dataSource: DataSource) {}

  list(q: ListAssetsQuery): Promise<Asset[]> {
    return this.dataSource.getRepository(Asset).find({
      where: {
        ...(q.building_id ? { buildingId: q.building_id } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.common_area === undefined ? {} : { roomId: q.common_area ? IsNull() : Not(IsNull()) }),
        // room_id ระบุเจาะจงกว่า common_area จึงเขียนทับ
        ...(q.room_id ? { roomId: q.room_id } : {}),
      },
      order: { assetCode: 'ASC' },
    });
  }

  async get(id: string): Promise<Asset> {
    const asset = await this.dataSource.getRepository(Asset).findOne({ where: { id } });
    if (!asset) throw notFound('ไม่พบครุภัณฑ์');
    return asset;
  }

  create(dto: AssetDto): Promise<Asset> {
    return this.dataSource.transaction(async (m) => {
      const loc = await this.resolveLocation(m, dto.building_id, dto.room_id ?? null);
      // รหัสซ้ำปล่อยให้ uq_assets_code ตัดสิน (23505 → 409)
      return m.getRepository(Asset).save(
        m.getRepository(Asset).create({
          assetCode: dto.asset_code,
          name: dto.name,
          category: dto.category,
          buildingId: loc.buildingId,
          roomId: loc.roomId,
          locationNote: dto.location_note ?? null,
          // สุ่มเอง 128 บิต: QR ต้องเดาไม่ได้ ไม่ใช้ asset_code ที่ไล่เลขได้ทั้งหอ
          qrToken: randomBytes(16).toString('hex'),
        }),
      );
    });
  }

  replace(id: string, dto: AssetDto): Promise<Asset> {
    return this.dataSource.transaction(async (m) => {
      const asset = await this.lockAsset(m, id);
      const loc = await this.resolveLocation(m, dto.building_id, dto.room_id ?? null);
      asset.assetCode = dto.asset_code;
      asset.name = dto.name;
      asset.category = dto.category;
      asset.buildingId = loc.buildingId;
      asset.roomId = loc.roomId;
      asset.locationNote = dto.location_note ?? null;
      return m.getRepository(Asset).save(asset);
    });
  }

  patch(id: string, dto: PatchAssetDto): Promise<Asset> {
    return this.dataSource.transaction(async (m) => {
      const asset = await this.lockAsset(m, id);

      if (dto.room_id !== undefined || dto.building_id !== undefined) {
        const roomId = dto.room_id === undefined ? asset.roomId : dto.room_id;
        // ย้ายออกเป็นส่วนกลางโดยไม่บอกอาคาร = อยู่อาคารเดิม
        const buildingId = dto.building_id ?? (roomId === null ? asset.buildingId : undefined);
        const loc = await this.resolveLocation(m, buildingId, roomId);
        asset.buildingId = loc.buildingId;
        asset.roomId = loc.roomId;
      }
      if (dto.asset_code !== undefined) asset.assetCode = dto.asset_code;
      if (dto.name !== undefined) asset.name = dto.name;
      if (dto.category !== undefined) asset.category = dto.category;
      if (dto.location_note !== undefined) asset.locationNote = dto.location_note;
      return m.getRepository(Asset).save(asset);
    });
  }

  async remove(id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const asset = await this.lockAsset(m, id);
      // ใบที่ยังเปิดอยู่ต้องมีครุภัณฑ์ให้ช่างไปซ่อม — ต้องปิด / ปฏิเสธ / ยกเลิกใบก่อน
      const open: { ticket_no: string }[] = await m.query(
        `SELECT ticket_no FROM tickets
         WHERE asset_id = $1 AND deleted_at IS NULL AND status = ANY($2::ticket_status[])`,
        [asset.id, [...OPEN_STATUSES]],
      );
      if (open.length > 0) {
        throw conflict('ASSET_HAS_OPEN_TICKET', 'ลบไม่ได้ ครุภัณฑ์นี้ยังมีใบแจ้งซ่อมที่ยังไม่ปิด', {
          tickets: open.map((t) => t.ticket_no),
        });
      }
      // soft delete: ใบแจ้งซ่อมเก่ายังอ้างถึงครุภัณฑ์นี้ได้
      await m.getRepository(Asset).softDelete({ id: asset.id });
    });
  }

  private async lockAsset(m: EntityManager, id: string): Promise<Asset> {
    const asset = await m.getRepository(Asset).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!asset) throw notFound('ไม่พบครุภัณฑ์');
    return asset;
  }

  // ที่เดียวที่ตัดสินว่าครุภัณฑ์อยู่อาคารไหน: ในห้อง → อาคารของห้องเสมอ · ส่วนกลาง → ต้องระบุอาคาร
  // FK อย่างเดียวไม่พอ เพราะห้อง/อาคารที่ถูก soft delete ยังมีแถวอยู่
  private async resolveLocation(
    m: EntityManager,
    buildingId: string | undefined,
    roomId: string | null,
  ): Promise<Location> {
    if (roomId) {
      const room = await m.getRepository(Room).findOne({ where: { id: roomId } });
      if (!room) throw badRequest('ROOM_NOT_FOUND', 'ไม่พบห้องพักที่ระบุ');
      if (buildingId && buildingId !== room.buildingId) {
        throw badRequest('BUILDING_MISMATCH', 'อาคารที่ระบุไม่ตรงกับอาคารของห้อง');
      }
      return { buildingId: room.buildingId, roomId: room.id };
    }
    if (!buildingId) throw badRequest('BUILDING_REQUIRED', 'ครุภัณฑ์ส่วนกลางต้องระบุอาคาร');
    const exists = await m.getRepository(Building).exists({ where: { id: buildingId } });
    if (!exists) throw badRequest('BUILDING_NOT_FOUND', 'ไม่พบอาคารที่ระบุ');
    return { buildingId, roomId: null };
  }
}
