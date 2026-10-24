import type { ReactNode } from 'react';

// โครงหน้าเดียวกันทุกหน้า: หัว → เนื้อหาเลื่อนได้ → แถบล่าง (แทนกรอบเครื่องของต้นแบบ)
export function Shell({ header, children, footer }: { header: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="shell">
      {header}
      <main className="scroll">{children}</main>
      {footer}
    </div>
  );
}
