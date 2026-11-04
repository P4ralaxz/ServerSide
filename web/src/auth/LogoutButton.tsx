import { useConfirm } from '../ui/Confirm';
import { Icon } from '../ui/icons';
import { logout } from './session';

// ปุ่มออกจากระบบบนหัวหน้าจอ — ถามก่อนเพราะอยู่มุมเดียวกับปุ่มอื่น กดพลาดแล้วต้องรอรหัสใหม่ (ขอได้ทุก 60 วินาที)
export function LogoutButton() {
  const confirm = useConfirm();
  const onClick = async () => {
    const ok = await confirm({
      title: 'ออกจากระบบ',
      body: 'เข้าใช้งานครั้งถัดไปต้องขอรหัสทางอีเมลใหม่',
      confirmLabel: 'ออกจากระบบ',
    });
    if (ok) logout();
  };
  return (
    <button className="iconbtn" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={onClick}>
      <Icon name="logout" size={22} />
    </button>
  );
}
