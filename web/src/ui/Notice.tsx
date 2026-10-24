import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

const ICON: Record<'info' | 'warn' | 'bad', IconName> = { info: 'clock', warn: 'info', bad: 'alert' };

export function Notice({
  tone,
  icon,
  children,
}: {
  tone: 'info' | 'warn' | 'bad';
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={icon ?? ICON[tone]} size={18} />
      <span>{children}</span>
    </div>
  );
}
