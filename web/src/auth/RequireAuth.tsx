import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getSession } from './session';

// ยังไม่ login → ไปหน้า login พร้อมจำหน้าที่จะกลับมา (เช่น /app/scan/:qrToken ที่สแกนมา)
export function RequireAuth({ children }: { children: ReactNode }) {
  const loc = useLocation();
  if (!getSession()) {
    const next = `/app${loc.pathname}${loc.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

export const useMe = () => getSession()?.user ?? null;
