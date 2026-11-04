import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/errors';
import { slaSummary, stageDurations, technicianReport, type Period } from '../../api/reports';
import type { ReportMetrics, StageDuration, TechnicianRow } from '../../api/types';
import { Empty, Loading } from '../../ui/Empty';
import { thaiDate } from '../../ui/format';
import { statusColor, statusLabel } from '../../ui/status';
import { DeskBar, DeskPage } from '../staff/desk';

// รายงาน (UI-PLAN 5) — กราฟทำด้วย HTML/CSS ตามต้นแบบ ไม่มี library กราฟ
// ช่วงเวลาอยู่ใน URL ส่งลิงก์ต่อแล้วเห็นตัวเลขชุดเดียวกัน · วันคิดตามเวลาไทย (API ตีความ from/to เป็นวันไทย)

type PeriodKey = 'last30' | 'thisMonth' | 'lastMonth' | 'all';
const PERIODS: { key: PeriodKey; label: string; range: (now: Date) => Period }[] = [
  {
    key: 'last30',
    label: '30 วันล่าสุด',
    range: (now) => ({ from: thaiDate(new Date(now.getTime() - 29 * 86_400_000)), to: thaiDate(now) }),
  },
  {
    key: 'thisMonth',
    label: 'เดือนนี้',
    range: (now) => ({ from: `${thaiDate(now).slice(0, 7)}-01`, to: thaiDate(now) }),
  },
  {
    key: 'lastMonth',
    label: 'เดือนที่แล้ว',
    range: (now) => {
      const firstOfThis = new Date(`${thaiDate(now).slice(0, 7)}-01T00:00:00+07:00`);
      const lastOfPrev = new Date(firstOfThis.getTime() - 86_400_000);
      return { from: `${thaiDate(lastOfPrev).slice(0, 7)}-01`, to: thaiDate(lastOfPrev) };
    },
  },
  { key: 'all', label: 'ทั้งหมด', range: () => ({}) },
];

const hours = (h: number | null | undefined): string =>
  h === null || h === undefined ? '–' : `${h < 10 ? h.toFixed(1) : Math.round(h)} ชม.`;
const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–');

// ขั้นที่แสดงในกราฟเวลาค้าง — ขั้นปลายทางไม่มีเวลาค้าง (API ไม่ส่งมาอยู่แล้ว)
const STAGES = ['open', 'assigned', 'in_progress', 'pending_parts', 'resolved'] as const;

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const period = PERIODS.find((p) => p.key === params.get('period')) ?? PERIODS[0];
  const range = period.range(new Date());

  const summary = useQuery({ queryKey: ['report', 'summary', range], queryFn: () => slaSummary(range) });
  const stages = useQuery({ queryKey: ['report', 'stages', range], queryFn: () => stageDurations(range) });
  const techs = useQuery({ queryKey: ['report', 'techs', range], queryFn: () => technicianReport(range) });

  return (
    <DeskPage>
      <div className="desk">
        <DeskBar active="reports" />
        <div className="rtitle" style={{ padding: '14px 18px' }}>
          <h1 style={{ fontSize: 20 }}>รายงาน</h1>
          <label className="row small muted">
            ช่วงเวลา
            <select
              className="select"
              value={period.key}
              onChange={(e) => setParams({ period: e.target.value }, { replace: true })}
            >
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {summary.isPending ? (
        <Loading rows={1} />
      ) : summary.isError ? (
        <Empty>{errorMessage(summary.error)}</Empty>
      ) : (
        <Kpis m={summary.data.total} />
      )}

      <div className="rgrid">
        <section className="rcard" aria-label="เวลาเฉลี่ยที่ค้างในแต่ละขั้น">
          <h3>เวลาเฉลี่ยที่ค้างในแต่ละขั้น · {period.label}</h3>
          {stages.isPending ? (
            <Loading rows={1} />
          ) : stages.isError ? (
            <p className="note">{errorMessage(stages.error)}</p>
          ) : (
            <StageBars rows={stages.data} />
          )}
        </section>

        <section className="rcard" aria-label="ใครเป็นคนปิดใบ">
          <h3>ใครเป็นคนปิดใบ</h3>
          {summary.isPending ? (
            <Loading rows={1} />
          ) : summary.isError ? (
            <p className="note">{errorMessage(summary.error)}</p>
          ) : (
            <WhoClosed m={summary.data.total} />
          )}
        </section>

        <section className="rcard" aria-label="งานของช่างแต่ละคน">
          <h3>งานของช่างแต่ละคน</h3>
          {techs.isPending ? (
            <Loading rows={1} />
          ) : techs.isError ? (
            <p className="note">{errorMessage(techs.error)}</p>
          ) : (
            <TechTable rows={techs.data} />
          )}
        </section>
      </div>
    </DeskPage>
  );
}

function Kpis({ m }: { m: ReportMetrics }) {
  const closed = m.closed_tickets;
  return (
    <div className="kpis num">
      <div className="kpi">
        <b>{hours(m.median_repair_hours)}</b>
        <span>เวลาซ่อมมัธยฐาน ไม่นับช่วงรออะไหล่</span>
      </div>
      <div className="kpi">
        <b>{pct(m.user_confirmed, closed)}</b>
        <span>ผู้พักยืนยันเองว่าหาย</span>
      </div>
      <div className="kpi">
        <b>{pct(m.auto_closed, closed)}</b>
        <span>ระบบปิดให้เมื่อครบ 3 วัน</span>
      </div>
      <div className="kpi">
        <b>{pct(m.reopened_tickets, m.total_tickets)}</b>
        <span>ถูกส่งกลับว่ายังไม่หาย</span>
      </div>
    </div>
  );
}

function StageBars({ rows }: { rows: StageDuration[] }) {
  const shown = STAGES.map((s) => rows.find((r) => r.stage === s)).filter((r): r is StageDuration => !!r);
  if (!shown.some((r) => r.avg_hours !== null)) return <p className="note">ยังไม่มีใบที่ผ่านขั้นไหนในช่วงนี้</p>;
  const max = Math.max(...shown.map((r) => r.avg_hours ?? 0), 0.0001);
  const skipped = shown.filter((r) => !r.counted_in_sla).map((r) => statusLabel(r.stage));
  return (
    <>
      <div className="bars num">
        {shown.map((r) => (
          <div className="bar" key={r.stage}>
            <span>{statusLabel(r.stage)}</span>
            <span className="track" role="img" aria-label={`${statusLabel(r.stage)} เฉลี่ย ${hours(r.avg_hours)}`}>
              <span
                className="fill"
                style={{ width: `${((r.avg_hours ?? 0) / max) * 100}%`, background: statusColor(r.stage) }}
              />
            </span>
            <span className="v">{hours(r.avg_hours)}</span>
          </div>
        ))}
      </div>
      {skipped.length > 0 && <p className="note">ช่วง{skipped.join('และ')}ไม่นับเข้าเวลาซ่อม</p>}
    </>
  );
}

function WhoClosed({ m }: { m: ReportMetrics }) {
  const total = m.user_confirmed + m.staff_confirmed + m.auto_closed;
  if (total === 0) return <p className="note">ยังไม่มีใบที่ปิดในช่วงนี้</p>;
  const parts = [
    { label: 'ผู้พักยืนยัน', n: m.user_confirmed, color: 'var(--st-closed)' },
    { label: 'Staff ยืนยัน (ส่วนกลาง)', n: m.staff_confirmed, color: 'var(--st-assigned)' },
    { label: 'ระบบปิดให้', n: m.auto_closed, color: 'var(--st-muted)' },
  ];
  return (
    <>
      <div className="stackbar" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.n, total)}`).join(' ')}>
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="legend num">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} {pct(p.n, total)}
          </span>
        ))}
      </div>
      <p className="note">ใบที่ระบบปิดให้ไม่มีชื่อผู้ยืนยัน จึงแยกจากใบที่มีคนยืนยันจริงได้</p>
    </>
  );
}

function TechTable({ rows }: { rows: TechnicianRow[] }) {
  if (rows.length === 0) return <p className="note">ยังไม่มีงานของช่างในช่วงนี้</p>;
  return (
    <>
      <div className="tablewrap">
        <table className="num">
          <thead>
            <tr>
              <th>ช่าง</th>
              <th>ซ่อมเสร็จ</th>
              <th>เวลามัธยฐาน</th>
              <th>ถูกส่งกลับ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.technician.id}>
                <td>{r.technician.name ?? '-'}</td>
                <td>{r.resolved_total}</td>
                <td>{hours(r.median_sla_hours)}</td>
                <td>{r.reopen_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">จำนวนครั้งที่ถูกส่งกลับคือสัญญาณคุณภาพงาน เวลามัธยฐานไม่นับช่วงรออะไหล่</p>
    </>
  );
}
