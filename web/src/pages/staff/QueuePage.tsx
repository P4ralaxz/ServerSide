import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/errors';
import { listTickets, queueCounts, type TicketQuery } from '../../api/tickets';
import type { QueueCounts } from '../../api/types';
import { formatAge } from '../../ui/format';
import { Pill } from '../../ui/Pill';
import { Priority } from '../../ui/Priority';
import { OPEN_STATUSES } from '../../ui/status';
import { placeOf } from '../student/student';
import { DeskBar, DeskPage } from './desk';
import { COUNTS_KEY, QUEUE_KEY } from './keys';
import { StaffPanel } from './StaffPanel';

// ตัวกรอง 6 ตัวของคิว (UI-PLAN 5) — แต่ละตัวคือ query ของ GET /tickets ชุดเดียวกับที่ queue-counts นับ
// ต้องตรงกับ QUEUE_COUNTERS ฝั่ง backend (src/modules/tickets/ticket-filters.ts) ไม่งั้นตัวเลขบนชิปไม่เท่าจำนวนแถว
type FilterKey = keyof QueueCounts;
const FILTERS: { key: FilterKey; label: string; query: TicketQuery; alert?: boolean }[] = [
  { key: 'open_total', label: 'ทั้งหมดที่เปิดอยู่', query: { status: OPEN_STATUSES } },
  { key: 'unassigned', label: 'รอมอบหมาย', query: { status: ['open'] } },
  { key: 'urgent', label: 'ด่วนมาก', query: { priority: 'urgent' }, alert: true },
  { key: 'disputed', label: 'มีคนแย้งว่ายังไม่หาย', query: { disputed: true }, alert: true },
  { key: 'reopened', label: 'ถูกส่งกลับ', query: { reopened: true } },
  { key: 'common_pending_confirm', label: 'ส่วนกลางรอยืนยัน', query: { scope: 'common_area', status: ['resolved'] } },
];
const LIMIT = 100;

// คิวงานของ Staff (เดสก์ท็อป) — ตัวกรอง + ตาราง + แผงรายละเอียดของใบที่เลือก
// ตัวกรองและใบที่เลือกอยู่ใน URL: refresh / ส่งลิงก์ต่อแล้วเห็นหน้าเดิม และลิงก์ในอีเมลพาไปที่ใบได้ตรง ๆ
export function QueuePage() {
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get('filter')) ?? FILTERS[0];
  const selected = params.get('ticket');

  const counts = useQuery({ queryKey: COUNTS_KEY, queryFn: queueCounts });
  const rows = useQuery({
    queryKey: [...QUEUE_KEY, filter.key],
    queryFn: () => listTickets({ ...filter.query, limit: LIMIT }),
  });

  const go = (next: { filter?: FilterKey; ticket?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.filter) p.set('filter', next.filter);
    if (next.ticket === null) p.delete('ticket');
    else if (next.ticket) p.set('ticket', next.ticket);
    setParams(p, { replace: true });
  };

  return (
    <DeskPage>
      <div className="desk">
        <DeskBar active="queue" />
        <div className="chips" role="group" aria-label="กรองคิว">
          {FILTERS.map((f) => {
            const n = counts.data?.[f.key];
            return (
              <button
                key={f.key}
                type="button"
                className={`chip${f.alert && n ? ' alert' : ''}`}
                aria-pressed={f.key === filter.key}
                onClick={() => go({ filter: f.key })}
              >
                <b className="num">{n ?? '–'}</b>
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>
        {counts.isError && (
          <p className="small muted" style={{ padding: '0 18px' }}>
            {errorMessage(counts.error)}
          </p>
        )}
        <div className="desk-grid">
          <div className="tablewrap">
            <table>
              <caption className="sr-only">{filter.label}</caption>
              <thead>
                <tr>
                  <th>เลขใบ</th>
                  <th>ครุภัณฑ์ / ที่ตั้ง</th>
                  <th>สถานะ</th>
                  <th>ความด่วน</th>
                  <th>คนเจอ</th>
                  <th>ช่าง</th>
                </tr>
              </thead>
              <tbody className="num">
                {rows.isPending && (
                  <tr>
                    <td colSpan={6} className="muted">
                      กำลังโหลด…
                    </td>
                  </tr>
                )}
                {rows.isError && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {errorMessage(rows.error)}
                    </td>
                  </tr>
                )}
                {rows.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      ไม่มีใบในตัวกรองนี้
                    </td>
                  </tr>
                )}
                {rows.data?.map((t) => (
                  <tr
                    key={t.id}
                    className={t.id === selected ? 'sel' : undefined}
                    tabIndex={0}
                    aria-selected={t.id === selected}
                    onClick={() => go({ ticket: t.id })}
                    onKeyDown={(e) => e.key === 'Enter' && go({ ticket: t.id })}
                  >
                    <td>
                      <span className="tno">{t.ticket_no}</span>
                      <span className="sub">แจ้ง {formatAge(t.created_at)}</span>
                    </td>
                    <td>
                      {t.asset.name}
                      <span className="sub">{placeOf(t)}</span>
                    </td>
                    <td>
                      <Pill status={t.status} />
                      {t.reopen_count > 0 && <span className="sub">ถูกส่งกลับ {t.reopen_count} ครั้ง</span>}
                    </td>
                    <td>
                      <Priority priority={t.priority} />
                    </td>
                    <td>{t.report_count}</td>
                    <td>{t.assignee?.name ?? <span className="muted">-</span>}</td>
                  </tr>
                ))}
                {rows.data?.length === LIMIT && (
                  <tr>
                    <td colSpan={6} className="muted small">
                      แสดง {LIMIT} ใบแรก — เลือกตัวกรองให้แคบลงเพื่อดูใบที่เหลือ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <aside className="side" aria-label="รายละเอียดใบที่เลือก">
            {selected ? <StaffPanel id={selected} /> : <p className="muted">เลือกใบจากตาราง</p>}
          </aside>
        </div>
      </div>
    </DeskPage>
  );
}
