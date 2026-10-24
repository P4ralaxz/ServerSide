import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './icons';

interface Props {
  title: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  // ช่องติ๊กของหน้าแจ้งซ่อม — มีค่า = แถวนี้เป็นตัวเลือก (aria-pressed)
  checked?: boolean;
  trailing?: ReactNode;
  chevron?: boolean;
  dim?: boolean;
  to?: string;
  onClick?: () => void;
  testId?: string;
}

export function ListRow({ title, sub, icon, checked, trailing, chevron, dim, to, onClick, testId }: Props) {
  const inner = (
    <>
      {checked !== undefined && (
        <span className={`check${checked ? ' on' : ''}`}>{checked && <Icon name="check" size={16} />}</span>
      )}
      {icon && (
        <span className="thumb">
          <Icon name={icon} />
        </span>
      )}
      <span className="grow">
        <span className="t">{title}</span>
        {sub && <span className="s">{sub}</span>}
      </span>
      {trailing}
      {chevron && (
        <span className="chev">
          <Icon name="chev" />
        </span>
      )}
    </>
  );
  const cls = `li${dim ? ' dim' : ''}`;
  if (to) {
    return (
      <Link className={cls} to={to} data-testid={testId}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button className={cls} type="button" onClick={onClick} aria-pressed={checked} data-testid={testId}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} data-testid={testId}>
      {inner}
    </div>
  );
}

export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="list" role="list" aria-label={label}>
      {children}
    </div>
  );
}
