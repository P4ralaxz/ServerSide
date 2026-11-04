import { Link } from 'react-router-dom';
import type { Ticket } from '../../api/types';
import { useMe } from '../../auth/RequireAuth';
import { formatWhen } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Pill } from '../../ui/Pill';
import { Priority } from '../../ui/Priority';
import { isReturned } from '../../ui/status';
import { placeOf } from '../student/student';

// ตัวอักษรแรกของชื่อบนหัวหน้าจอช่าง (ต้นแบบ)
export function Avatar() {
  const me = useMe();
  const name = me?.full_name ?? me?.email ?? '';
  return (
    <span className="avatar" aria-label={name}>
      {name.slice(0, 1)}
    </span>
  );
}

// แถวงานหนึ่งใบ (jobRow ของต้นแบบ): ชื่อ, ความด่วน, ที่ตั้ง, เลขใบ, สถานะ, นัด, เข้าห้องได้ไหม, อะไหล่ที่รอ
export function JobRow({ ticket: t }: { ticket: Ticket }) {
  const meta: { icon: 'cal' | 'door' | 'box'; text: string }[] = [];
  if (t.scheduled_at) meta.push({ icon: 'cal', text: formatWhen(t.scheduled_at) });
  if (t.room) meta.push({ icon: 'door', text: t.permission_to_enter ? 'เข้าได้เลย' : 'ต้องนัดก่อน' });
  if (t.waiting_for_parts) meta.push({ icon: 'box', text: t.waiting_for_parts });
  return (
    <Link className="li" to={`/jobs/${t.id}`}>
      <span className="grow">
        <span className="spread">
          <span className="t">{t.asset.name}</span>
          <Priority priority={t.priority} />
        </span>
        <span className="s">
          {placeOf(t)} · <span className="num">{t.ticket_no}</span>
        </span>
        {isReturned(t) && t.last_reopen_note && (
          <span className="quote">
            {t.room ? 'ผู้พักแจ้ง' : 'Staff แจ้ง'}: "{t.last_reopen_note}"
          </span>
        )}
        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Pill status={t.status} />
          {meta.map((m, i) => (
            <span className="s row" style={{ gap: 5 }} key={m.icon}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <Icon name={m.icon} size={14} />
              {m.text}
            </span>
          ))}
        </span>
      </span>
      <span className="chev">
        <Icon name="chev" />
      </span>
    </Link>
  );
}
