import { AppHeader } from '../ui/AppHeader';
import { Button } from '../ui/Button';
import { Empty } from '../ui/Empty';
import { Shell } from '../ui/Shell';

export function NotFoundPage() {
  return (
    <Shell header={<AppHeader title="ไม่พบหน้านี้" />}>
      <Empty action={<Button to="/">กลับหน้าแรก</Button>}>ไม่พบหน้าที่คุณเปิด ลิงก์อาจพิมพ์ผิดหรือหมดอายุแล้ว</Empty>
    </Shell>
  );
}

// ช่าง / Staff / Admin — หน้าของบทบาทเหล่านี้มาใน UI-2 (UI-PLAN 8)
export function RolePendingPage() {
  return (
    <Shell header={<AppHeader title="แจ้งซ่อมหอพัก" />}>
      <Empty>หน้าสำหรับบทบาทของคุณยังไม่เปิดใช้บนเว็บ ระหว่างนี้ใช้งานผ่าน API ที่ /docs</Empty>
    </Shell>
  );
}
