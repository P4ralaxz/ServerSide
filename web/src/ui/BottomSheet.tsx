import { useEffect, useRef, type ReactNode } from 'react';

// การกระทำที่เปลี่ยนสถานะเปิดเป็น bottom sheet (UI-PLAN 2 ข้อ 6) — ปิดได้ด้วยฉากหลัง ปุ่ม Esc หรือปุ่มในแผ่น
export function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // โฟกัสช่องแรกในแผ่น — คนใช้คีย์บอร์ด / screen reader ต้องไม่ค้างอยู่ที่ปุ่มข้างหลังฉาก
    ref.current?.querySelector<HTMLElement>('textarea, input, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <button className="scrimbg" type="button" aria-label="ปิด" tabIndex={-1} onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        <div className="grab" />
        {children}
      </div>
    </>
  );
}
