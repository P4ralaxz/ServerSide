// ที่เดียวที่บอกว่า "วัน/เดือน/ปี" ของระบบคิดตามเวลาไทย — เลขใบ (JS) และรายงาน (SQL) อ่านค่าเดียวกันนี้
// ใบที่แจ้งตี 1 วันที่ 1 (ไทย) = 18:00 ของวันก่อนหน้าใน UTC ต้องนับเป็นวัน/เดือน/ปีใหม่
export const THAI_TZ = 'Asia/Bangkok';

const thaiYear = new Intl.DateTimeFormat('en-US', { timeZone: THAI_TZ, year: 'numeric' });

export const thaiBuddhistYear = (d: Date = new Date()): number => Number(thaiYear.format(d)) + 543;

export const formatTicketNo = (beYear: number, seq: number): string => `TK-${beYear}-${String(seq).padStart(6, '0')}`;
