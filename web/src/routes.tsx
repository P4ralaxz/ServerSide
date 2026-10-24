import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, useMe } from './auth/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage, RolePendingPage } from './pages/NotFoundPage';
import { MyTicketsPage } from './pages/student/MyTicketsPage';
import { ReportPage } from './pages/student/ReportPage';
import { ScanPage } from './pages/student/ScanPage';
import { TicketDetailPage } from './pages/student/TicketDetailPage';

// หน้าแรกหลัง login ตาม role — ที่เดียวที่หน้าเว็บอ่าน role ได้ (UI-PLAN 2 ข้อ 1)
// หน้าช่าง / Staff มาใน UI-2 ตอนนี้บอกผู้ใช้ตรง ๆ แทนการพาไปหน้าที่ยังไม่มี
function Home() {
  const me = useMe();
  if (me?.role === 'student') return <Navigate to="/report" replace />;
  return <RolePendingPage />;
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
      <Route path="/tickets/:id" element={guard(<TicketDetailPage />)} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
