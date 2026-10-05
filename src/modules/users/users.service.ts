import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, ILike } from 'typeorm';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { Room, User } from '../../database/entities';
import { UserRole } from '../../domain/enums';
import { OPEN_STATUSES } from '../../domain/status-rules';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto';

// ฟิลด์ที่ staff แก้ได้ — ที่เหลือเป็นของ admin
const STAFF_FIELDS: ReadonlySet<keyof UpdateUserDto> = new Set(['room_id']);

@Injectable()
export class UsersService {
  constructor(private readonly dataSource: DataSource) {}

  list(q: ListUsersQuery): Promise<User[]> {
    return this.dataSource.getRepository(User).find({
      where: {
        ...(q.role ? { role: q.role } : {}),
        ...(q.email ? { email: ILike(`%${q.email.replace(/[%_\\]/g, '\\$&')}%`) } : {}),
        ...(q.room_id ? { roomId: q.room_id } : {}),
        ...(q.is_active === undefined ? {} : { isActive: q.is_active }),
      },
      order: { createdAt: 'ASC', email: 'ASC' },
    });
  }

  create(dto: CreateUserDto): Promise<User> {
    const role = dto.role ?? 'student';
    const roomId = dto.room_id ?? null;
    this.assertTechnicianHasNoRoom(role, roomId);

    return this.dataSource.transaction(async (m) => {
      if (roomId) await this.assertRoomHasSpace(m, roomId, null);
      // อีเมลซ้ำปล่อยให้ uq_users_email ตัดสิน (23505 → 409 ผ่าน DbErrorFilter)
      // เช็คเองก่อน insert กันสองคำขอพร้อมกันไม่ได้อยู่ดี
      return m
        .getRepository(User)
        .save(m.getRepository(User).create({ email: dto.email, role, fullName: dto.full_name ?? null, roomId }));
    });
  }

  update(actor: User, id: string, dto: UpdateUserDto): Promise<User> {
    const fields = (Object.keys(dto) as (keyof UpdateUserDto)[]).filter((k) => dto[k] !== undefined);
    if (actor.role !== 'admin') {
      const denied = fields.filter((f) => !STAFF_FIELDS.has(f));
      if (denied.length > 0) throw forbidden('แก้ไขได้เฉพาะห้องพักของผู้ใช้', { fields: denied });
    }

    return this.dataSource.transaction(async (m) => {
      // lock แถว users ก่อนเสมอ แล้วค่อย rooms / tickets — ลำดับเดียวกันทุกที่ กัน deadlock
      const user = await this.lockUser(m, id);

      const nextRole = dto.role ?? user.role;
      const nextActive = dto.is_active ?? user.isActive;
      const nextRoom = dto.room_id === undefined ? user.roomId : dto.room_id;

      if (actor.id === user.id && (nextRole !== user.role || !nextActive)) {
        throw badRequest('CANNOT_CHANGE_SELF', 'เปลี่ยน role หรือระงับบัญชีของตัวเองไม่ได้');
      }
      this.assertTechnicianHasNoRoom(nextRole, nextRoom);

      // ช่างที่กำลังจะรับงานไม่ได้ (ถูกระงับ / ไม่เป็นช่างแล้ว) ต้องไม่มีใบค้างอยู่กับตัว
      if (user.role === 'technician' && (nextRole !== 'technician' || (user.isActive && !nextActive))) {
        await this.assertNoOpenTickets(m, user.id);
      }
      if (nextRoom && nextRoom !== user.roomId) await this.assertRoomHasSpace(m, nextRoom, user.id);

      user.role = nextRole;
      user.isActive = nextActive;
      user.roomId = nextRoom;
      if (dto.full_name !== undefined) user.fullName = dto.full_name;
      return m.getRepository(User).save(user);
    });
  }

  async remove(actor: User, id: string): Promise<void> {
    if (actor.id === id) throw badRequest('CANNOT_CHANGE_SELF', 'ลบบัญชีของตัวเองไม่ได้');

    await this.dataSource.transaction(async (m) => {
      const user = await this.lockUser(m, id);
      if (user.role === 'technician') await this.assertNoOpenTickets(m, user.id);
      // soft delete เท่านั้น: ใบแจ้งซ่อมและ log เก่ายังต้องอ้างถึงคนนี้ได้
      await m.getRepository(User).softDelete({ id: user.id });
    });
  }

  private async lockUser(m: EntityManager, id: string): Promise<User> {
    const user = await m.getRepository(User).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!user) throw notFound('ไม่พบผู้ใช้');
    return user;
  }

  // กฎเดียวกับ ck_technician_no_room — เช็คที่นี่ก่อนเพื่อให้ข้อความบอกสาเหตุได้ชัดกว่า CHECK_VIOLATION
  private assertTechnicianHasNoRoom(role: UserRole, roomId: string | null): void {
    if (role === 'technician' && roomId) {
      throw badRequest('TECHNICIAN_CANNOT_HAVE_ROOM', 'บัญชีช่างผูกห้องพักไม่ได้');
    }
  }

  private async assertRoomHasSpace(m: EntityManager, roomId: string, exceptUserId: string | null): Promise<void> {
    // lock แถวของห้องก่อนนับ: ผูกสองคนเข้าห้องที่เหลือที่เดียวพร้อมกัน ถ้าไม่ lock จะนับจากภาพเดียวกันแล้วผ่านทั้งคู่
    const room = await m.getRepository(Room).findOne({ where: { id: roomId }, lock: { mode: 'pessimistic_write' } });
    if (!room) throw badRequest('ROOM_NOT_FOUND', 'ไม่พบห้องพักที่ระบุ');

    const occupants = await m
      .getRepository(User)
      .createQueryBuilder('u')
      .where('u.room_id = :roomId', { roomId })
      .andWhere(exceptUserId ? 'u.id <> :exceptUserId' : '1 = 1', { exceptUserId })
      .getCount();
    if (occupants >= room.capacity) {
      throw conflict('ROOM_FULL', 'ห้องนี้มีผู้พักครบตามจำนวนแล้ว', { capacity: room.capacity, occupants });
    }
  }

  // เรียกหลัง lockUser เท่านั้น — /assign (สัปดาห์ 4) จะ lock แถว users ของช่างตัวเดียวกันก่อนมอบงาน
  // สองฝั่งจึงเข้าคิวกัน ไม่มีช่องให้มอบงานให้ช่างที่กำลังถูกระงับ
  private async assertNoOpenTickets(m: EntityManager, technicianId: string): Promise<void> {
    const rows: { ticket_no: string }[] = await m.query(
      `SELECT ticket_no FROM tickets
       WHERE assigned_to = $1 AND deleted_at IS NULL AND status = ANY($2::ticket_status[])
       ORDER BY ticket_no`,
      [technicianId, [...OPEN_STATUSES]],
    );
    if (rows.length > 0) {
      throw conflict('TECHNICIAN_HAS_OPEN_TICKETS', 'ช่างคนนี้ยังมีใบแจ้งซ่อมค้างอยู่ ต้องมอบหมายให้คนอื่นก่อน', {
        tickets: rows.map((r) => r.ticket_no),
      });
    }
  }
}
