import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './icons';

// back = path ที่จะกลับไปเมื่อเปิดหน้านี้ตรง ๆ (ไม่มีประวัติในแท็บ เช่น เปิดจากลิงก์ในอีเมล)
// onBack = ย้อนขั้นภายในหน้าเดียวกัน (เช่น กรอกรหัส → กรอกอีเมล)
export function AppHeader({
  title,
  back,
  onBack,
  right,
}: {
  title: ReactNode;
  back?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  const goBack = () => {
    if (onBack) onBack();
    else if (window.history.state && window.history.state.idx > 0) navigate(-1);
    else if (back) navigate(back, { replace: true });
  };
  return (
    <header className="ahead">
      {(back !== undefined || onBack) && (
        <button className="iconbtn" type="button" aria-label="ย้อนกลับ" onClick={goBack}>
          <Icon name="back" size={22} />
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}
