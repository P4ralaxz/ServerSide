import { Link } from 'react-router-dom';
import { Icon, type IconName } from './icons';

export interface Tab {
  key: string;
  label: string;
  icon: IconName;
  to: string;
  badge?: number;
}

export function TabBar({ tabs, active }: { tabs: Tab[]; active: string }) {
  return (
    <nav className="tabbar" aria-label="เมนู">
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} aria-current={t.key === active ? 'page' : undefined}>
          <Icon name={t.icon} size={24} />
          {t.label}
          {t.badge ? (
            <span className="badge num" aria-label={`${t.badge} ใบที่ยังเปิดอยู่`}>
              {t.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
