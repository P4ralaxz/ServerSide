import { TicketStatus } from '../../domain/enums';
import { OPEN_STATUSES } from '../../domain/status-rules';
import { ListTicketsQuery } from './tickets.dto';

export interface SqlFilter {
  sql: string;
  params: Record<string, unknown>;
}

export type TicketFilterInput = Omit<ListTicketsQuery, 'limit' | 'offset'>;

// ตัวกรองของ GET /tickets ทั้งหมดอยู่ที่นี่ที่เดียว (alias ของ tickets = t) และซ้อนบน visibilityFilter เสมอ
// GET /tickets/queue-counts นับด้วยฟังก์ชันนี้ตัวเดียวกัน — ตัวเลขบนชิปของ Staff ต้องเท่ากับจำนวนรายการ
// ที่ได้เมื่อกดชิปนั้น (DESIGN 7.6) ถ้าเขียนเงื่อนไขสองชุด วันหนึ่งตัวเลขกับรายการจะไม่ตรงกัน
// p = prefix ของชื่อ parameter: queue-counts วางหลายชุดในคำสั่งเดียว ชื่อจึงห้ามชนกัน
export const ticketFilters = (q: TicketFilterInput, userId: string, p = ''): SqlFilter[] => {
  const f: SqlFilter[] = [];
  const open = { [`${p}open`]: [...OPEN_STATUSES] };

  if (q.status?.length) f.push({ sql: `t.status IN (:...${p}status)`, params: { [`${p}status`]: q.status } });
  if (q.scope) f.push({ sql: `t.scope = :${p}scope`, params: { [`${p}scope`]: q.scope } });
  if (q.room_id) f.push({ sql: `t.room_id = :${p}roomId`, params: { [`${p}roomId`]: q.room_id } });
  if (q.asset_id) f.push({ sql: `t.asset_id = :${p}assetId`, params: { [`${p}assetId`]: q.asset_id } });
  if (q.batch_id) f.push({ sql: `t.batch_id = :${p}batchId`, params: { [`${p}batchId`]: q.batch_id } });
  if (q.mine) f.push({ sql: `t.reporter_id = :${p}me`, params: { [`${p}me`]: userId } });
  // tickets ไม่มี building ของตัวเอง — อาคารคืออาคารของครุภัณฑ์
  if (q.building_id) {
    f.push({
      sql: `t.asset_id IN (SELECT a.id FROM assets a WHERE a.building_id = :${p}buildingId)`,
      params: { [`${p}buildingId`]: q.building_id },
    });
  }
  // ความด่วนของใบที่จบแล้วไม่มีความหมายกับคิว — นับเฉพาะใบที่ยังต้องมีคนทำอะไรต่อ
  if (q.priority) {
    f.push({
      sql: `t.priority = :${p}priority AND t.status IN (:...${p}open)`,
      params: { [`${p}priority`]: q.priority, ...open },
    });
  }
  if (q.disputed !== undefined) {
    // มีคนแย้งว่ายังไม่หายหลังช่างกด resolved — job ไม่ปิดใบพวกนี้ Staff ต้องตัดสินเอง (DESIGN 3.4)
    const disputed = `t.status = 'resolved' AND t.disputed_at IS NOT NULL`;
    f.push({ sql: q.disputed ? `(${disputed})` : `NOT (${disputed})`, params: {} });
  }
  if (q.reopened !== undefined) {
    const reopened = `t.reopen_count > 0 AND t.status IN (:...${p}open)`;
    f.push({ sql: q.reopened ? `(${reopened})` : `NOT (${reopened})`, params: open });
  }
  return f;
};

// ตัวเลขบนชิปของคิว Staff — แต่ละตัวคือ query param ชุดหนึ่งของ GET /tickets (เทสเทียบสองฝั่ง)
// ตัวนับ "เกิน SLA" ในต้นแบบตัดออกแล้ว (DESIGN 12.3 ข้อ 8): ใบที่เกินเป้าเป็นรายงาน ไม่ใช่คิว
export const QUEUE_COUNTERS = {
  open_total: { status: [...OPEN_STATUSES] as TicketStatus[] },
  unassigned: { status: ['open'] as TicketStatus[] },
  urgent: { priority: 'urgent' },
  disputed: { disputed: true },
  reopened: { reopened: true },
  common_pending_confirm: { scope: 'common_area', status: ['resolved'] as TicketStatus[] },
} as const satisfies Record<string, TicketFilterInput>;

export type QueueCounter = keyof typeof QUEUE_COUNTERS;
