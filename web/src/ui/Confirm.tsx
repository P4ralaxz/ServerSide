import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';

// กล่องยืนยันของแอปแทน window.confirm — กล่องของเบราว์เซอร์แต่งไม่ได้ ขึ้นชื่อโดเมน ngrok และปุ่มเป็นภาษาอังกฤษ
// ใช้กับการกระทำที่ย้อนยาก (ออกจากระบบ, เปลี่ยนบทบาท, ระงับบัญชี) — การเปลี่ยนสถานะใบยังใช้ bottom sheet (UI-PLAN 2 ข้อ 6)
export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask>(() => Promise.resolve(false));

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback<Ask>((o) => new Promise((resolve) => setOpen({ ...o, resolve })), []);
  // อ้างอิงคงที่ต่อการเปิดหนึ่งครั้ง — ไม่งั้น effect ของกล่องจะรันใหม่แล้วดึงโฟกัสกลับไปปุ่มยกเลิก
  const close = useCallback(
    (ok: boolean) => {
      open?.resolve(ok);
      setOpen(null);
    },
    [open],
  );
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open && <ConfirmDialog {...open} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    // โฟกัสปุ่มยกเลิกก่อน — กด Enter โดยไม่ได้ตั้งใจต้องไม่ทำการกระทำที่ย้อนยาก
    ref.current?.querySelector<HTMLElement>('[data-cancel]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
      // วนโฟกัสอยู่ในกล่อง ไม่หลุดไปปุ่มข้างหลังฉาก
      if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      back?.focus();
    };
  }, [onClose]);

  return (
    <>
      <button className="scrimbg" type="button" aria-label="ปิด" tabIndex={-1} onClick={() => onClose(false)} />
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-b`}
        ref={ref}
      >
        <h2 id={`${id}-t`}>{title}</h2>
        <div id={`${id}-b`} className="dialog-body">
          {body}
        </div>
        <div className="dialog-actions">
          <button className="btn" type="button" data-cancel onClick={() => onClose(false)}>
            ยกเลิก
          </button>
          <Button variant={danger ? 'dangerfill' : 'primary'} onClick={() => onClose(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
