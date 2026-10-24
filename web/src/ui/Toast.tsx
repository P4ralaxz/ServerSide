import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

// toast เมื่อทำรายการสำเร็จ (UI-PLAN 2 ข้อ 6) — อยู่ระดับแอป ไม่ใช่ระดับหน้า เพราะบางปุ่มพาไปหน้าอื่นทันทีหลังสำเร็จ
const ToastContext = createContext<(message: string) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    // 2.6 วินาทีเท่าต้นแบบ
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">
        {message && (
          <div className="toast" role="status">
            <Icon name="checkc" size={18} />
            <span>{message}</span>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
