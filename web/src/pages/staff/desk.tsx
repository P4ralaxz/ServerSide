import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { canManageUsers } from '../../auth/access';
import { LogoutButton } from '../../auth/LogoutButton';
import { useMe } from '../../auth/RequireAuth';
import { Icon } from '../../ui/icons';
import { roleLabel } from '../../ui/role';

// แถบบนของหน้าเดสก์ท็อป (desk-bar ของต้นแบบ) + เมนูคิวงาน / รายงาน / ผู้ใช้ (admin)
export function DeskBar({ active }: { active: 'queue' | 'reports' | 'users' }) {
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
        {canManageUsers(me?.role) && (
          <Link to="/users" aria-current={active === 'users' ? 'page' : undefined}>
            ผู้ใช้
          </Link>
        )}
      </nav>
      <span className="who">
        <span className="avatar" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        {name} {me && `(${roleLabel(me.role)})`}
        <LogoutButton />
      </span>
    </div>
  );
}

export function DeskPage({ children }: { children: ReactNode }) {
  return <main className="deskpage">{children}</main>;
}
