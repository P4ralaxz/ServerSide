import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api/client';
import { AppRoutes } from './routes';
import { ConfirmProvider } from './ui/Confirm';
import { ToastProvider } from './ui/Toast';

// error 4xx คือคำตอบของ API (ไม่มีสิทธิ์ / ไม่พบ / สถานะเปลี่ยน) ลองซ้ำก็ได้ผลเดิม — ลองซ้ำเฉพาะเครือข่ายหรือ 5xx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, e) => count < 2 && !(e instanceof ApiError && e.httpStatus < 500),
      refetchOnWindowFocus: true,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter basename="/app">
            <AppRoutes />
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
