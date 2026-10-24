import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CODE_TTL_MINUTES, RESEND_AFTER_SECONDS, requestCode, verifyCode } from '../api/auth';
import { ApiError } from '../api/client';
import { attemptsLeft, errorMessage, retryAfter } from '../api/errors';
import { safeNext, setSession } from '../auth/session';
import { AppHeader } from '../ui/AppHeader';
import { Button } from '../ui/Button';
import { Field, invalidProps } from '../ui/Field';
import { Icon } from '../ui/icons';
import { Shell } from '../ui/Shell';
import { formatSeconds } from '../ui/format';

// error ของขั้นกรอกรหัส → ข้อความใต้ช่อง (UI-PLAN 5, 6)
const codeError = (e: unknown): string => {
  if (!(e instanceof ApiError)) return errorMessage(e);
  switch (e.code) {
    case 'INVALID_CODE': {
      const left = attemptsLeft(e);
      if (left === null) return 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว ขอรหัสใหม่';
      return left > 0 ? `รหัสไม่ถูกต้อง ลองได้อีก ${left} ครั้ง` : 'รหัสไม่ถูกต้อง ลองครบแล้ว กรุณาขอรหัสใหม่';
    }
    case 'CODE_LOCKED':
      return 'ลองรหัสผิดครบ 5 ครั้งแล้ว กรุณาขอรหัสใหม่';
    case 'ACCOUNT_DISABLED':
      return 'บัญชีนี้ถูกระงับการใช้งาน ติดต่อ Staff ของหอพัก';
    case 'VALIDATION_FAILED':
      return 'กรอกรหัสตัวเลข 6 หลัก';
    default:
      return errorMessage(e);
  }
};

const emailError = (e: unknown): string =>
  e instanceof ApiError && e.code === 'VALIDATION_FAILED'
    ? 'ใช้อีเมล @kmitl.ac.th ของมหาวิทยาลัยเท่านั้น'
    : errorMessage(e);

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const fromScan = next.startsWith('/app/scan/');

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  // นับถอยหลังเวลาขอรหัสใหม่ — 429 ของ API บอก retry_after จริงมาด้วย ถ้ามีจะใช้ค่านั้นแทน
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!email.trim()) return setError('กรอกอีเมลก่อน');
    setBusy(true);
    try {
      await requestCode(email.trim());
      setStep('code');
      setCode('');
      setWait(RESEND_AFTER_SECONDS);
    } catch (err) {
      setError(emailError(err));
      const after = retryAfter(err);
      if (after !== null && step === 'code') setWait(after);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('กรอกรหัสตัวเลข 6 หลัก');
    setBusy(true);
    try {
      const res = await verifyCode(email.trim(), code);
      setSession({ token: res.access_token, user: res.user });
      // next เป็น path เต็ม (/app/...) ส่วน router มี basename /app อยู่แล้ว
      navigate(next.replace(/^\/app/, '') || '/', { replace: true });
    } catch (err) {
      setError(codeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <Shell
        header={
          <AppHeader
            title="กรอกรหัส"
            onBack={() => {
              setStep('email');
              setError(null);
            }}
          />
        }
      >
        <form className="stack" style={{ gap: 16 }} onSubmit={verify} noValidate>
          <div className="stack">
            <p className="title-lg">กรอกรหัสจากอีเมล</p>
            <p className="muted">ส่งไปที่ {email.trim()} แล้ว</p>
          </div>
          <Field id="otp" label="รหัส 6 หลัก" error={error}>
            <input
              className={`input otp num${error ? ' err' : ''}`}
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              {...invalidProps('otp', error)}
            />
          </Field>
          <p className="small muted num">
            รหัสใช้ได้ {CODE_TTL_MINUTES} นาที ·{' '}
            {wait > 0 ? (
              `ขอรหัสใหม่ได้ใน ${formatSeconds(wait)}`
            ) : (
              <button className="linkbtn" type="button" onClick={() => void send()} disabled={busy}>
                ขอรหัสใหม่
              </button>
            )}
          </p>
          <Button variant="primary" type="submit" busy={busy}>
            ยืนยันรหัส
          </Button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell header={<AppHeader title="เข้าสู่ระบบ" />}>
      <form className="stack" style={{ gap: 16 }} onSubmit={send} noValidate>
        {fromScan && (
          <div className="scanned">
            <span className="thumb">
              <Icon name="qr" />
            </span>
            <span>คุณสแกน QR ครุภัณฑ์ในหอพัก เข้าสู่ระบบแล้วจะพาไปที่ชิ้นนั้น</span>
          </div>
        )}
        <div className="stack">
          <p className="title-lg">ใช้อีเมลมหาวิทยาลัยเข้าสู่ระบบ</p>
          <p className="muted">เราจะส่งรหัส 6 หลักไปที่อีเมล ไม่ต้องตั้งรหัสผ่าน</p>
        </div>
        <Field id="email" label="อีเมล" error={error}>
          <input
            className={`input${error ? ' err' : ''}`}
            id="email"
            type="email"
            autoComplete="email"
            placeholder="รหัสนักศึกษา@kmitl.ac.th"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            {...invalidProps('email', error)}
          />
        </Field>
        <Button variant="primary" type="submit" busy={busy}>
          ส่งรหัสทางอีเมล
        </Button>
      </form>
    </Shell>
  );
}
