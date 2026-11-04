import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../../api/errors';
import { listTickets } from '../../api/tickets';
import type { Ticket } from '../../api/types';
import { useMe } from '../../auth/RequireAuth';
import { AppHeader } from '../../ui/AppHeader';
import { Button } from '../../ui/Button';
import { Empty, Loading } from '../../ui/Empty';
import { formatLongDay } from '../../ui/format';
import { Icon, type IconName } from '../../ui/icons';
import { List } from '../../ui/ListRow';
import { Shell } from '../../ui/Shell';
import { OPEN_STATUSES, TECH_GROUPS, techGroup, type TechGroup } from '../../ui/status';
import { Avatar, JobRow } from './tech';

const GROUP: Record<TechGroup, { label: string; icon?: IconName }> = {
  returned: { label: 'ถูกส่งกลับ', icon: 'undo' },
  today: { label: 'นัดวันนี้', icon: 'cal' },
  parts: { label: 'รออะไหล่', icon: 'box' },
  other: { label: 'อื่น ๆ' },
  waiting: { label: 'รอผู้พักยืนยัน', icon: 'clock' },
};

export const JOBS_KEY = ['jobs'] as const;

// งานของฉัน (UI-PLAN 5) — API ส่งเฉพาะใบที่มอบหมายให้ช่างคนนี้ (visibilityFilter) หน้าจอไม่กรองซ้ำเอง
export function JobsPage() {
  const me = useMe();
  const q = useQuery({
    queryKey: [...JOBS_KEY, me?.id],
    queryFn: () => listTickets({ status: OPEN_STATUSES, limit: 100 }),
  });
  const header = <AppHeader title="งานของฉัน" right={<Avatar />} />;

  if (q.isPending) {
    return (
      <Shell header={header}>
        <Loading rows={3} />
      </Shell>
    );
  }
  if (q.isError) {
    return (
      <Shell header={header}>
        <Empty action={<Button onClick={() => void q.refetch()}>ลองอีกครั้ง</Button>}>{errorMessage(q.error)}</Empty>
      </Shell>
    );
  }

  const now = new Date();
  const groups = new Map<TechGroup, Ticket[]>(TECH_GROUPS.map((g) => [g, []]));
  for (const t of q.data) groups.get(techGroup(t, now))!.push(t);

  return (
    <Shell header={header}>
      <p className="muted small">{formatLongDay(now)}</p>
      {q.data.length === 0 && <p className="empty">ยังไม่มีงานที่มอบหมายให้คุณ</p>}
      {TECH_GROUPS.filter((g) => groups.get(g)!.length > 0).map((g) => (
        <section className="stack" key={g} aria-label={GROUP[g].label}>
          <h2 className="sectionh">
            <span className="row" style={{ gap: 6 }}>
              {GROUP[g].icon && <Icon name={GROUP[g].icon!} size={15} />}
              {GROUP[g].label}
            </span>
            <span className="num">{groups.get(g)!.length}</span>
          </h2>
          <List label={GROUP[g].label}>
            {groups.get(g)!.map((t) => (
              <JobRow key={t.id} ticket={t} />
            ))}
          </List>
        </section>
      ))}
    </Shell>
  );
}
