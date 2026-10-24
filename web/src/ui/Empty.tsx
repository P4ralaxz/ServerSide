import type { ReactNode } from 'react';

// state "ว่าง" และ "error" ของทุกหน้า (UI-PLAN 2 ข้อ 3) — บอกเสมอว่าทำอะไรต่อได้
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="stack">
      <p className="empty">{children}</p>
      {action}
    </div>
  );
}

export function Loading({ rows = 2 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
