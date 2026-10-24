import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'quiet' | 'danger' | 'default';

interface Props {
  children: ReactNode;
  variant?: Variant;
  small?: boolean;
  // มี to = ลิงก์ไปหน้าอื่น (ใช้ <a> ให้เปิดแท็บใหม่ / กด back ได้ตามปกติ) · ไม่มี = ปุ่มทำงาน
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  // ระหว่างรอ API — กดซ้ำไม่ได้ แต่ข้อความบนปุ่มไม่เปลี่ยน ให้ผู้ใช้รู้ว่ากดอะไรไป
  busy?: boolean;
  type?: 'button' | 'submit';
}

export function Button({ children, variant = 'default', small, to, onClick, disabled, busy, type = 'button' }: Props) {
  const cls = ['btn', variant === 'default' ? '' : variant, small ? 'sm' : ''].filter(Boolean).join(' ');
  if (to) {
    return (
      <Link className={cls} to={to}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}
