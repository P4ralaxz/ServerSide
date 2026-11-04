import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../../auth/RequireAuth';
import { Icon } from '../../ui/icons';

const ROLE_LABEL: Record<string, string> = { staff: 'Staff', admin: 'Admin' };

// แถบบนของหน้าเดสก์ท็อป (desk-bar ของต้นแบบ) + เมนูระหว่างคิวงานกับรายงาน
export function DeskBar({ active }: { active: 'queue' | 'reports' }) {
  const me = useMe();
  const name = me?.full_name ?? me?.email ?? '';
  return (
    <div className="desk-bar">
      <span className="brand">
        <Icon name="wrench" />
        แจ้งซ่อมหอพัก
      </span>
      <nav aria-label="เมนู">
        <Link to="/queue" aria-current={active === 'queue' ? 'page' : undefined}>
          คิวงาน
        </Link>
        <Link to="/reports" aria-current={active === 'reports' ? 'page' : undefined}>
          รายงาน
        </Link>
      </nav>
      <span className="who">
        <span className="avatar" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        {name} ({ROLE_LABEL[me?.role ?? ''] ?? me?.role})
      </span>
    </div>
  );
}

export function DeskPage({ children }: { children: ReactNode }) {
  return <main className="deskpage">{children}</main>;
}
