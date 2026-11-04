import { Icon } from '../ui/icons';
import { logout } from './session';

// ปุ่มออกจากระบบบนหัวหน้าจอ — ถามก่อนเพราะอยู่มุมเดียวกับปุ่มอื่น กดพลาดแล้วต้องรอรหัสใหม่ (ขอได้ทุก 60 วินาที)
export function LogoutButton() {
  const onClick = () => {
    if (window.confirm('ออกจากระบบ?')) logout();
  };
  return (
    <button className="iconbtn" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={onClick}>
      <Icon name="logout" size={22} />
    </button>
  );
}
