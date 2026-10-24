import type { ReactNode } from 'react';

export function Card({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className="card" aria-label={label}>
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

// แถว "หัวข้อ — ค่า" ในการ์ดข้อมูล (.kv ของต้นแบบ)
export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => (
        <div className="r" key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}
