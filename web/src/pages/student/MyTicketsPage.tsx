import { errorMessage } from '../../api/errors';
import type { Ticket } from '../../api/types';
import { LogoutButton } from '../../auth/LogoutButton';
import { AppHeader } from '../../ui/AppHeader';
import { Button } from '../../ui/Button';
import { categoryIcon } from '../../ui/category';
import { Empty, Loading } from '../../ui/Empty';
import { List, ListRow } from '../../ui/ListRow';
import { Pill } from '../../ui/Pill';
import { Shell } from '../../ui/Shell';
import { studentGroup, type StudentGroup } from '../../ui/status';
import { StudentTabs, useMyTickets } from './student';

// ลำดับกลุ่มตามต้นแบบ: สิ่งที่ผู้พักต้องทำอยู่บนสุด (UI-PLAN 5)
const GROUPS: { key: StudentGroup; label: string; empty: string }[] = [
  { key: 'waiting', label: 'รอคุณยืนยัน', empty: 'ไม่มีใบที่รอคุณยืนยัน' },
  { key: 'active', label: 'กำลังดำเนินการ', empty: 'ไม่มีงานที่กำลังซ่อม' },
  { key: 'done', label: 'ปิดแล้ว', empty: 'ยังไม่มีใบที่ปิดแล้ว' },
];

export function MyTicketsPage() {
  const q = useMyTickets();
  const footer = <StudentTabs active="tickets" />;
  const header = <AppHeader title="ส่งซ่อมแล้ว" right={<LogoutButton />} />;

  if (q.isPending) {
    return (
      <Shell header={header} footer={footer}>
        <Loading rows={3} />
      </Shell>
    );
  }
  if (q.isError) {
    return (
      <Shell header={header} footer={footer}>
        <Empty action={<Button onClick={() => void q.refetch()}>ลองอีกครั้ง</Button>}>{errorMessage(q.error)}</Empty>
      </Shell>
    );
  }
  if (q.data.length === 0) {
    return (
      <Shell header={header} footer={footer}>
        <Empty
          action={
            <Button variant="primary" to="/report">
              แจ้งซ่อม
            </Button>
          }
        >
          ยังไม่มีการแจ้งซ่อมของห้องคุณ เจอของเสียให้สแกน QR บนชิ้นนั้น หรือกดแจ้งซ่อมด้านล่าง
        </Empty>
      </Shell>
    );
  }

  const byGroup = (g: StudentGroup) => q.data.filter((t) => studentGroup(t) === g);
  return (
    <Shell header={header} footer={footer}>
      {GROUPS.map((g) => (
        <Group key={g.key} label={g.label} empty={g.empty} tickets={byGroup(g.key)} />
      ))}
    </Shell>
  );
}

function Group({ label, empty, tickets }: { label: string; empty: string; tickets: Ticket[] }) {
  return (
    <section className="stack" aria-label={label}>
      <h2 className="sectionh">
        <span>{label}</span>
        <span className="num">{tickets.length}</span>
      </h2>
      {tickets.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <List label={label}>
          {tickets.map((t) => (
            <ListRow
              key={t.id}
              to={`/tickets/${t.id}`}
              icon={categoryIcon(t.asset.category)}
              title={t.asset.name}
              sub={<span className="num">{t.ticket_no}</span>}
              trailing={<Pill status={t.status} />}
            />
          ))}
        </List>
      )}
    </section>
  );
}
