import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { canManageUsers, HOME } from './auth/access';
import { RequireAuth, useMe } from './auth/RequireAuth';
import { UsersPage } from './pages/admin/UsersPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage, RolePendingPage } from './pages/NotFoundPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { QueuePage } from './pages/staff/QueuePage';
import { MyTicketsPage } from './pages/student/MyTicketsPage';
import { ReportPage } from './pages/student/ReportPage';
import { ScanPage } from './pages/student/ScanPage';
import { TicketDetailPage } from './pages/student/TicketDetailPage';
import { JobDetailPage } from './pages/tech/JobDetailPage';
import { JobsPage } from './pages/tech/JobsPage';

// role ใช้ได้ที่ไฟล์นี้กับ auth/access.ts เท่านั้น และใช้แค่เลือกว่าจะเปิดหน้าไหน (UI-PLAN 2 ข้อ 1) — สิทธิ์จริงตรวจที่ API ทุกครั้ง
function Home() {
  const me = useMe();
  const home = me ? HOME[me.role] : undefined;
  return home ? <Navigate to={home} replace /> : <RolePendingPage />;
}

// /app/tickets/:id เป็นลิงก์ในอีเมล (DESIGN 6.10) — staff เปิดแล้วไปที่คิวพร้อมเลือกใบนั้น ช่างไปหน้างาน
// นักศึกษาเห็นหน้ารายละเอียดใบของตัวเอง
function TicketRoute() {
  const me = useMe();
  const { id = '' } = useParams();
  if (me?.role === 'staff' || me?.role === 'admin') return <Navigate to={`/queue?ticket=${id}`} replace />;
  if (me?.role === 'technician') return <Navigate to={`/jobs/${id}`} replace />;
  return <TicketDetailPage />;
}

// คนที่ไม่ใช่ admin เปิด /app/users ตรง ๆ → กลับหน้าแรกของตัวเอง (API ก็ตอบ 403 อยู่แล้ว)
function UsersRoute() {
  const me = useMe();
  return canManageUsers(me?.role) ? <UsersPage /> : <Navigate to="/" replace />;
}

export function AppRoutes() {
  const guard = (el: JSX.Element) => <RequireAuth>{el}</RequireAuth>;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={guard(<Home />)} />
      <Route path="/scan/:qrToken" element={guard(<ScanPage />)} />
      <Route path="/report" element={guard(<ReportPage />)} />
      <Route path="/tickets" element={guard(<MyTicketsPage />)} />
      <Route path="/tickets/:id" element={guard(<TicketRoute />)} />
      <Route path="/jobs" element={guard(<JobsPage />)} />
      <Route path="/jobs/:id" element={guard(<JobDetailPage />)} />
      <Route path="/queue" element={guard(<QueuePage />)} />
      <Route path="/reports" element={guard(<ReportsPage />)} />
      <Route path="/users" element={guard(<UsersRoute />)} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
