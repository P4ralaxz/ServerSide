// เวลาทั้งแอปแสดงตามเวลาไทยเสมอ ไม่ขึ้นกับ timezone ของเครื่องที่เปิด — ตรงกับรายงานและเลขใบฝั่ง backend
const TZ = 'Asia/Bangkok';

const dayFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// "วันนี้ 13:00" หรือ "1 ต.ค. 20:05" ตามต้นแบบ
export const formatWhen = (iso: string, now: Date = new Date()): string => {
  const d = new Date(iso);
  const day = dayKey.format(d) === dayKey.format(now) ? 'วันนี้' : dayFmt.format(d);
  return `${day} ${timeFmt.format(d)}`;
};

// เวลาค้างในแต่ละขั้นของ timeline — หยาบพอให้อ่านเร็ว ("3 ชม.", "2 วัน")
export const formatDuration = (seconds: number): string => {
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${Math.max(min, 1)} นาที`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ชม.`;
  return `${Math.floor(h / 24)} วัน`;
};

// เวลาที่เหลือก่อนระบบปิดใบให้ (auto_close_at) — "2 วัน 5 ชม." ตามต้นแบบ
export const formatRemaining = (iso: string, now: Date = new Date()): string => {
  const min = Math.max(0, Math.floor((new Date(iso).getTime() - now.getTime()) / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return h > 0 ? `${d} วัน ${h} ชม.` : `${d} วัน`;
  if (h > 0) return `${h} ชม. ${min % 60} นาที`;
  return `${Math.max(min, 1)} นาที`;
};

export const formatSeconds = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ประโยคบนจอเรียกช่างด้วยชื่อต้น ("ส่งกลับให้ช่างสมชายแล้ว") ตามต้นแบบ — ชื่อเต็มอยู่ในการ์ดข้อมูล
export const firstName = (name: string | null | undefined): string => (name ?? '').trim().split(/\s+/)[0] ?? '';

export const isPast = (iso: string, now: Date = new Date()): boolean => new Date(iso).getTime() <= now.getTime();
