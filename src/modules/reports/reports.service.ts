import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { THAI_TZ } from '../../common/time/thai-year';
import { TicketStatus } from '../../domain/enums';
import { SLA_COUNTED_STAGES, SLA_TARGET_HOURS } from '../../domain/sla';
import { OPEN_STATUSES } from '../../domain/status-rules';
import {
  ReportDimension,
  ReportMetrics,
  ReportQuery,
  SlaSummaryView,
  StageDurationRow,
  SummaryQuery,
  SummaryRow,
  TechnicianReportRow,
} from './reports.dto';

// parameter แบบตำแหน่งของ pg — ค่าทุกตัวจากผู้ใช้ผ่านที่นี่ ไม่ต่อ string เข้า SQL ตรง ๆ
class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

const hours = (v: number | null): number | null => (v === null ? null : Math.round(v * 100) / 100);

// รายงานทั้งหมด (DESIGN 9) — raw SQL ล้วน เพราะ @DeleteDateColumn ไม่กรอง manager.query()
// ทุกรายงานเริ่มจาก CTE `scoped` ตัวเดียว: deleted_at และตัวกรองทุกตัวอยู่ที่นั่นที่เดียว
// ถ้าแต่ละรายงานเขียนเงื่อนไขเอง วันหนึ่งจะมีรายงานที่นับใบที่ถูกลบไปแล้ว
@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  async slaSummary(q: SummaryQuery): Promise<SlaSummaryView> {
    const dims = q.group_by ?? ['building', 'category'];
    const rows = await this.summaryRows(q, dims);
    const [total] = await this.summaryRows(q, []);
    return { group_by: dims, rows, total };
  }

  async stageDurations(q: ReportQuery): Promise<StageDurationRow[]> {
    const p = new Params();
    const scoped = this.scoped(q, p);
    // ขั้นปลายทาง (closed / rejected / cancelled) ไม่ใช่ "การค้าง" — view คิดแถวสุดท้ายถึง now() จึงโตไม่หยุด
    // ต้องกรองทิ้งเสมอ ไม่งั้นได้ขั้น closed เฉลี่ยหลายร้อยชั่วโมง (DESIGN 2.3)
    const waiting = p.add([...OPEN_STATUSES]);
    const rows: {
      stage: TicketStatus;
      completed_count: number;
      avg_hours: number | null;
      median_hours: number | null;
      waiting_now: number;
      max_waiting_hours: number | null;
    }[] = await this.dataSource.query(
      `WITH ${scoped},
       d AS (
         SELECT v.stage, v.left_at, EXTRACT(EPOCH FROM v.duration)::float8 / 3600 AS h
           FROM v_ticket_stage_durations v JOIN scoped s ON s.id = v.ticket_id
          WHERE v.stage = ANY(${waiting}::ticket_status[])
       )
       SELECT stage,
              count(*) FILTER (WHERE left_at IS NOT NULL)::int AS completed_count,
              avg(h) FILTER (WHERE left_at IS NOT NULL) AS avg_hours,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY h) FILTER (WHERE left_at IS NOT NULL) AS median_hours,
              count(*) FILTER (WHERE left_at IS NULL)::int AS waiting_now,
              max(h) FILTER (WHERE left_at IS NULL) AS max_waiting_hours
         FROM d
        GROUP BY stage
        ORDER BY array_position(${waiting}::ticket_status[], stage)`,
      p.values,
    );
    return rows.map((r) => ({
      stage: r.stage,
      counted_in_sla: SLA_COUNTED_STAGES.includes(r.stage),
      completed_count: r.completed_count,
      avg_hours: hours(r.avg_hours),
      median_hours: hours(r.median_hours),
      waiting_now: r.waiting_now,
      max_waiting_hours: hours(r.max_waiting_hours),
    }));
  }

  async technicians(q: ReportQuery): Promise<TechnicianReportRow[]> {
    const p = new Params();
    const scoped = this.scoped(q, p);
    const work = this.work(p);
    const target = this.target(p);
    const onlyTech = q.technician_id ? `AND u.id = ${p.add(q.technician_id)}` : '';
    const rows: {
      id: string;
      full_name: string | null;
      in_hand: number;
      resolved_total: number;
      closed_total: number;
      reopen_total: number;
      avg_hours_to_resolve: number | null;
      median_hours_to_resolve: number | null;
      median_sla_hours: number | null;
      late_resolved: number;
    }[] = await this.dataSource.query(
      `WITH ${scoped}, ${work},
       -- การกดซ่อมเสร็จแต่ละครั้ง: actor ของ log → resolved คือช่างเจ้าของงานตอนนั้นเสมอ (/status เป็นของช่างเจ้าของงานเท่านั้น)
       resolves AS (
         SELECT l.ticket_id, l.actor_id AS technician_id, l.created_at AS resolved_at
           FROM ticket_status_logs l JOIN scoped s ON s.id = l.ticket_id
          WHERE l.to_status = 'resolved' AND l.actor_id IS NOT NULL
       ),
       -- จุดเริ่มนับของช่าง = ครั้งล่าสุดก่อน resolve ที่งานมาถึงมือ: มอบหมาย / เปลี่ยนตัวช่าง / ถูกส่งกลับ
       -- เปลี่ยนตัวช่างตอน assigned ไม่มี status log (ขั้นไม่เปลี่ยน) จึงต้องอ่าน audit log ด้วย
       -- เวลาที่ใบค้างรอมอบหมายไม่ใช่ความรับผิดชอบของช่าง
       spans AS (
         SELECT r.*, (
           SELECT max(x.at) FROM (
             SELECT l2.created_at AS at FROM ticket_status_logs l2
              WHERE l2.ticket_id = r.ticket_id AND l2.to_status = 'assigned' AND l2.created_at <= r.resolved_at
             UNION ALL
             SELECT a.created_at FROM ticket_audit_logs a
              WHERE a.ticket_id = r.ticket_id AND a.action IN ('assign', 'reassign') AND a.created_at <= r.resolved_at
           ) x
         ) AS started_at
           FROM resolves r
       ),
       timed AS (
         SELECT sp.technician_id,
                EXTRACT(EPOCH FROM sp.resolved_at - sp.started_at)::float8 / 3600
                  - COALESCE((
                      SELECT EXTRACT(EPOCH FROM SUM(v.duration))::float8 / 3600
                        FROM v_ticket_stage_durations v
                       WHERE v.ticket_id = sp.ticket_id AND v.stage = 'pending_parts'
                         AND v.entered_at >= sp.started_at AND v.entered_at < sp.resolved_at
                    ), 0) AS h
           FROM spans sp
          WHERE sp.started_at IS NOT NULL
       ),
       -- การส่งกลับเป็นของช่างที่กดซ่อมเสร็จรอบก่อนหน้า: แถวก่อน resolved → assigned คือ log ของการ resolve นั้น
       reopens AS (
         SELECT x.prev_actor AS technician_id, count(*)::int AS n
           FROM (
             SELECT l.from_status, l.to_status,
                    LAG(l.actor_id) OVER (PARTITION BY l.ticket_id ORDER BY l.created_at, l.id) AS prev_actor
               FROM ticket_status_logs l JOIN scoped s ON s.id = l.ticket_id
           ) x
          WHERE x.from_status = 'resolved' AND x.to_status = 'assigned'
          GROUP BY x.prev_actor
       )
       SELECT u.id, u.full_name,
              (SELECT count(*) FROM scoped s
                WHERE s.assigned_to = u.id AND s.status IN ('assigned', 'in_progress', 'pending_parts'))::int AS in_hand,
              (SELECT count(*) FROM resolves r WHERE r.technician_id = u.id)::int AS resolved_total,
              (SELECT count(*) FROM scoped s WHERE s.assigned_to = u.id AND s.status = 'closed')::int AS closed_total,
              COALESCE((SELECT n FROM reopens r WHERE r.technician_id = u.id), 0) AS reopen_total,
              (SELECT avg(h) FROM timed t WHERE t.technician_id = u.id) AS avg_hours_to_resolve,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h) FROM timed t WHERE t.technician_id = u.id)
                AS median_hours_to_resolve,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY w.h)
                 FROM scoped s JOIN work w ON w.ticket_id = s.id
                WHERE s.assigned_to = u.id AND s.resolved_at IS NOT NULL) AS median_sla_hours,
              (SELECT count(*) FROM scoped s JOIN work w ON w.ticket_id = s.id
                WHERE s.assigned_to = u.id AND s.resolved_at IS NOT NULL AND w.h > ${target})::int AS late_resolved
         FROM users u
        WHERE u.role = 'technician' AND u.deleted_at IS NULL ${onlyTech}
        ORDER BY u.full_name NULLS LAST, u.email`,
      p.values,
    );
    // ช่างที่ยังไม่มีงานต้องขึ้นในรายงานเป็น 0 ไม่ใช่หายไป (เทสเดิม test_technician_workload)
    return rows.map((r) => ({
      technician: { id: r.id, name: r.full_name },
      in_hand: r.in_hand,
      resolved_total: r.resolved_total,
      closed_total: r.closed_total,
      reopen_total: r.reopen_total,
      avg_hours_to_resolve: hours(r.avg_hours_to_resolve),
      median_hours_to_resolve: hours(r.median_hours_to_resolve),
      median_sla_hours: hours(r.median_sla_hours),
      late_resolved: r.late_resolved,
    }));
  }

  // --- ส่วนประกอบของ SQL ที่ทุกรายงานใช้ร่วมกัน ---

  // ใบในขอบเขตของรายงาน — deleted_at และตัวกรองทุกตัวอยู่ที่นี่ที่เดียว
  // เดือน/วันคิดตามเวลาไทย: ใบที่แจ้ง 01:00 วันที่ 1 (ไทย) = 18:00 ของวันก่อนใน UTC ต้องตกเดือน/วันใหม่
  private scoped(q: ReportQuery, p: Params): string {
    const tz = p.add(THAI_TZ);
    const where = ['t.deleted_at IS NULL'];
    if (q.building_id) where.push(`a.building_id = ${p.add(q.building_id)}`);
    if (q.category) where.push(`a.category = ${p.add(q.category)}`);
    if (q.technician_id) where.push(`t.assigned_to = ${p.add(q.technician_id)}`);
    if (q.from) where.push(`t.created_at >= (${p.add(q.from)}::date::timestamp AT TIME ZONE ${tz})`);
    if (q.to) where.push(`t.created_at < ((${p.add(q.to)}::date + 1)::timestamp AT TIME ZONE ${tz})`);
    return `scoped AS (
      SELECT t.id, t.status, t.priority, t.assigned_to, t.reopen_count, t.resolved_at, t.closed_at,
             t.close_reason, t.disputed_at, a.building_id, b.name AS building_name, a.category,
             to_char(date_trunc('month', t.created_at AT TIME ZONE ${tz}), 'YYYY-MM') AS month
        FROM tickets t
        JOIN assets a ON a.id = t.asset_id
        JOIN buildings b ON b.id = a.building_id
       WHERE ${where.join(' AND ')}
    )`;
  }

  // เวลาซ่อมต่อใบ (DESIGN 9) = เวลาที่อยู่ใน SLA_COUNTED_STAGES ก่อน resolve ครั้งล่าสุด
  // ใบที่ยังไม่ resolve = เวลาที่ใช้ไปแล้วจนถึงตอนนี้ (ใช้นับใบที่เลยเป้าไปแล้วแต่ยังไม่เสร็จ)
  private work(p: Params): string {
    return `work AS (
      SELECT s.id AS ticket_id, EXTRACT(EPOCH FROM SUM(v.duration))::float8 / 3600 AS h
        FROM scoped s JOIN v_ticket_stage_durations v ON v.ticket_id = s.id
       WHERE v.stage = ANY(${p.add([...SLA_COUNTED_STAGES])}::ticket_status[])
         AND (s.resolved_at IS NULL OR v.entered_at < s.resolved_at)
       GROUP BY s.id
    )`;
  }

  // เป้าชั่วโมงของ priority ของใบนั้น — อ่านจาก SLA_TARGET_HOURS ค่าเดียว ไม่เขียนเลขซ้ำใน SQL
  private target(p: Params): string {
    return `(${p.add(JSON.stringify(SLA_TARGET_HOURS))}::jsonb ->> s.priority::text)::float8`;
  }

  private async summaryRows(q: ReportQuery, dims: ReportDimension[]): Promise<SummaryRow[]> {
    const p = new Params();
    const scoped = this.scoped(q, p);
    const work = this.work(p);
    const target = this.target(p);
    const open = p.add([...OPEN_STATUSES]);
    // เรียงตามชื่อที่คนอ่าน ไม่ใช่ uuid — ใบที่ยังไม่มีช่างอยู่ท้ายสุด
    const DIMS: Record<ReportDimension, { cols: string[]; order: string }> = {
      building: { cols: ['s.building_id', 's.building_name'], order: 's.building_name' },
      category: { cols: ['s.category'], order: 's.category' },
      technician: { cols: ['s.assigned_to', 'u.full_name'], order: 'u.full_name NULLS LAST' },
      month: { cols: ['s.month'], order: 's.month' },
    };
    const cols = dims.flatMap((d) => DIMS[d].cols);
    const select = cols.map((c) => `${c},`).join(' ');
    const groupBy = cols.length
      ? `GROUP BY ${cols.join(', ')} ORDER BY ${dims.map((d) => DIMS[d].order).join(', ')}`
      : '';

    const raw: Record<string, unknown>[] = await this.dataSource.query(
      `WITH ${scoped}, ${work}
       SELECT ${select}
              count(*)::int AS total_tickets,
              count(*) FILTER (WHERE s.status = ANY(${open}::ticket_status[]))::int AS open_tickets,
              count(*) FILTER (WHERE s.status = 'closed')::int AS closed_tickets,
              count(*) FILTER (WHERE s.status = 'rejected')::int AS rejected_tickets,
              count(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled_tickets,
              count(*) FILTER (WHERE s.close_reason = 'user_confirmed')::int AS user_confirmed,
              count(*) FILTER (WHERE s.close_reason = 'staff_confirmed')::int AS staff_confirmed,
              count(*) FILTER (WHERE s.close_reason = 'auto_closed')::int AS auto_closed,
              count(*) FILTER (WHERE s.status = 'closed' AND s.disputed_at IS NOT NULL)::int AS closed_while_disputed,
              count(*) FILTER (WHERE s.reopen_count > 0)::int AS reopened_tickets,
              COALESCE(sum(s.reopen_count), 0)::int AS reopen_total,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY w.h) FILTER (WHERE s.resolved_at IS NOT NULL)
                AS median_repair_hours,
              avg(w.h) FILTER (WHERE s.resolved_at IS NOT NULL) AS avg_repair_hours,
              avg(EXTRACT(EPOCH FROM s.closed_at - s.resolved_at)::float8 / 3600) FILTER (WHERE s.status = 'closed')
                AS avg_confirm_hours,
              count(*) FILTER (WHERE s.resolved_at IS NOT NULL AND w.h > ${target})::int AS over_sla,
              count(*) FILTER (
                WHERE s.status = ANY(${open}::ticket_status[]) AND s.status <> 'resolved'
                  AND COALESCE(w.h, 0) > ${target}
              )::int AS overdue_open
         FROM scoped s
         LEFT JOIN work w ON w.ticket_id = s.id
         LEFT JOIN users u ON u.id = s.assigned_to
         ${groupBy}`,
      p.values,
    );

    return raw.map((r) => {
      const metrics: ReportMetrics = {
        total_tickets: r.total_tickets as number,
        open_tickets: r.open_tickets as number,
        closed_tickets: r.closed_tickets as number,
        rejected_tickets: r.rejected_tickets as number,
        cancelled_tickets: r.cancelled_tickets as number,
        user_confirmed: r.user_confirmed as number,
        staff_confirmed: r.staff_confirmed as number,
        auto_closed: r.auto_closed as number,
        closed_while_disputed: r.closed_while_disputed as number,
        reopened_tickets: r.reopened_tickets as number,
        reopen_total: r.reopen_total as number,
        median_repair_hours: hours(r.median_repair_hours as number | null),
        avg_repair_hours: hours(r.avg_repair_hours as number | null),
        avg_confirm_hours: hours(r.avg_confirm_hours as number | null),
        over_sla: r.over_sla as number,
        overdue_open: r.overdue_open as number,
      };
      const row: SummaryRow = { ...metrics };
      if (dims.includes('building')) row.building = { id: r.building_id as string, name: r.building_name as string };
      if (dims.includes('category')) row.category = r.category as string;
      if (dims.includes('technician')) {
        row.technician = r.assigned_to === null ? null : { id: r.assigned_to as string, name: r.full_name as string };
      }
      if (dims.includes('month')) row.month = r.month as string;
      return row;
    });
  }
}
