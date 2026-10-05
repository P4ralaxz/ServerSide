import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { Asset, Building, Room, User } from '../../database/entities';
import { DEFAULT_ROOM_CAPACITY, ListRoomsQuery, PatchRoomDto, RoomDto } from './rooms.dto';

@Injectable()
export class RoomsService {
  constructor(private readonly dataSource: DataSource) {}

  list(q: ListRoomsQuery): Promise<Room[]> {
    return this.dataSource.getRepository(Room).find({
      where: q.building_id ? { buildingId: q.building_id } : {},
      order: { buildingId: 'ASC', roomNo: 'ASC' },
    });
  }

  async get(id: string): Promise<Room> {
    const room = await this.dataSource.getRepository(Room).findOne({ where: { id } });
    if (!room) throw notFound('ไม่พบห้องพัก');
    return room;
  }

  create(dto: RoomDto): Promise<Room> {
    return this.dataSource.transaction(async (m) => {
      await this.assertBuildingExists(m, dto.building_id);
      // เลขห้องซ้ำในอาคารเดียวกันปล่อยให้ uq_rooms_no ตัดสิน (23505 → 409)
      return m.getRepository(Room).save(
        m.getRepository(Room).create({
          buildingId: dto.building_id,
          roomNo: dto.room_no,
          floor: dto.floor,
          capacity: dto.capacity ?? DEFAULT_ROOM_CAPACITY,
        }),
      );
    });
  }

  replace(id: string, dto: RoomDto): Promise<Room> {
    return this.apply(id, { ...dto, capacity: dto.capacity ?? DEFAULT_ROOM_CAPACITY });
  }

  patch(id: string, dto: PatchRoomDto): Promise<Room> {
    return this.apply(id, dto);
  }

  private apply(id: string, dto: PatchRoomDto): Promise<Room> {
    return this.dataSource.transaction(async (m) => {
      const room = await this.lockRoom(m, id);

      if (dto.building_id !== undefined && dto.building_id !== room.buildingId) {
        await this.assertBuildingExists(m, dto.building_id);
        room.buildingId = dto.building_id;
        // assets.building_id ซ้ำกับของห้องโดยเจตนา (ครุภัณฑ์ส่วนกลางไม่มีห้องให้ join หาอาคาร)
        // ย้ายห้องไปอีกอาคารจึงต้องพาครุภัณฑ์ในห้องตามไปด้วย ไม่งั้นรายงานแยกตามอาคารจะนับผิดตึก
        await m.getRepository(Asset).update({ roomId: room.id }, { buildingId: dto.building_id });
      }
      if (dto.capacity !== undefined && dto.capacity < room.capacity) {
        const occupants = await m.getRepository(User).count({ where: { roomId: room.id } });
        if (occupants > dto.capacity) {
          throw conflict('ROOM_OVER_CAPACITY', 'ลดจำนวนที่พักต่ำกว่าจำนวนผู้พักปัจจุบันไม่ได้', { occupants });
        }
      }
      if (dto.room_no !== undefined) room.roomNo = dto.room_no;
      if (dto.floor !== undefined) room.floor = dto.floor;
      if (dto.capacity !== undefined) room.capacity = dto.capacity;
      return m.getRepository(Room).save(room);
    });
  }

  async remove(id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      // lock ตัวเดียวกับตอนผูกห้อง (UsersService.assertRoomHasSpace) — ลบห้องกับผูกคนเข้าห้องพร้อมกันจึงเข้าคิวกัน
      const room = await this.lockRoom(m, id);
      const occupants = await m.getRepository(User).count({ where: { roomId: room.id } });
      if (occupants > 0) throw conflict('ROOM_IN_USE', 'ลบไม่ได้ ห้องนี้ยังมีผู้พักอยู่', { occupants });
      // ถ้าปล่อยลบ ครุภัณฑ์จะชี้ไปห้องที่มองไม่เห็นแล้ว และใบแจ้งซ่อมของมันจะหาเจ้าของห้องไม่ได้
      const assets = await m.getRepository(Asset).count({ where: { roomId: room.id } });
      if (assets > 0) throw conflict('ROOM_HAS_ASSETS', 'ลบไม่ได้ ห้องนี้ยังมีครุภัณฑ์อยู่', { assets });
      await m.getRepository(Room).softDelete({ id: room.id });
    });
  }

  private async lockRoom(m: EntityManager, id: string): Promise<Room> {
    const room = await m.getRepository(Room).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!room) throw notFound('ไม่พบห้องพัก');
    return room;
  }

  // FK อย่างเดียวไม่พอ: อาคารที่ถูก soft delete ยังมีแถวอยู่ FK จึงผ่าน
  private async assertBuildingExists(m: EntityManager, buildingId: string): Promise<void> {
    const exists = await m.getRepository(Building).exists({ where: { id: buildingId } });
    if (!exists) throw badRequest('BUILDING_NOT_FOUND', 'ไม่พบอาคารที่ระบุ');
  }
}
