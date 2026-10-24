import type { CSSProperties, ReactNode } from 'react';

// error อยู่ใต้ช่องที่ผิดเสมอ (UI-PLAN 2 ข้อ 5) — ทั้งที่ฟอร์มบล็อกเองและที่ API ตอบ 400 กลับมา
export function Field({
  id,
  label,
  error,
  children,
  style,
}: {
  id: string;
  label: string;
  error?: string | null;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="field" style={style}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className="errtext" id={`${id}-err`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// props ที่ช่องกรอกต้องมีเมื่อผิด — ให้ screen reader อ่าน error ของช่องนั้นได้
export const invalidProps = (id: string, error?: string | null) =>
  error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-err` } : {};
