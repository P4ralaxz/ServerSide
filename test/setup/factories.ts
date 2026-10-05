import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TicketScope, TicketStatus, UserRole } from '../../src/domain/enums';

// เขียนตรงลง DB ด้วย SQL — ข้ามกฎของ service โดยเจตนา
// เพื่อให้เทสวางใบในสถานะใดก็ได้ และทดสอบได้ว่า DB ปฏิเสธเองเมื่อโค้ดพลาด

let seq = 0;
const next = (): number => ++seq;

export const makeBuilding = async (ds: DataSource, code = `B${next()}`): Promise<string> => {
  const id = randomUUID();
  await ds.query(`INSERT INTO buildings (id, code, name) VALUES ($1, $2, $3)`, [id, code, `อาคาร ${code}`]);
  return id;
};

export const makeRoom = async (ds: DataSource, buildingId: string, roomNo = `${300 + next()}`): Promise<string> => {
  const id = randomUUID();
  await ds.query(`INSERT INTO rooms (id, building_id, room_no, floor, capacity) VALUES ($1, $2, $3, 3, 2)`, [
    id,
    buildingId,
    roomNo,
  ]);
  return id;
};

export const makeUser = async (
  ds: DataSource,
  o: { role?: UserRole; roomId?: string | null; email?: string } = {},
): Promise<string> => {
  const id = randomUUID();
  await ds.query(`INSERT INTO users (id, email, role, room_id) VALUES ($1, $2, $3, $4)`, [
    id,
    o.email ?? `u${next()}@kmitl.ac.th`,
    o.role ?? 'student',
    o.roomId ?? null,
  ]);
  return id;
};

export const makeAsset = async (ds: DataSource, buildingId: string, roomId: string | null = null): Promise<string> => {
  const id = randomUUID();
  const n = next();
  await ds.query(
    `INSERT INTO assets (id, asset_code, name, category, building_id, room_id, qr_token)
     VALUES ($1, $2, 'ครุภัณฑ์ทดสอบ', 'electrical', $3, $4, $5)`,
    [id, `A-${n}`, buildingId, roomId, `qr-${n}-${id}`],
  );
  return id;
};

export interface TicketInput {
  assetId: string;
  reporterId: string;
  scope?: TicketScope;
  roomId?: string | null;
  status?: TicketStatus;
  permissionToEnter?: boolean;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  closeReason?: string | null;
  deletedAt?: Date | null;
}

export const makeTicket = async (ds: DataSource, o: TicketInput): Promise<string> => {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO tickets (id, ticket_no, batch_id, asset_id, scope, room_id, reporter_id, status, title,
                          permission_to_enter, resolved_at, closed_at, close_reason, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ทดสอบ', $9, $10, $11, $12, $13)`,
    [
      id,
      `TK-TEST-${String(next()).padStart(6, '0')}`,
      randomUUID(),
      o.assetId,
      o.scope ?? 'common_area',
      o.roomId ?? null,
      o.reporterId,
      o.status ?? 'open',
      o.permissionToEnter ?? false,
      o.resolvedAt ?? null,
      o.closedAt ?? null,
      o.closeReason ?? null,
      o.deletedAt ?? null,
    ],
  );
  return id;
};
