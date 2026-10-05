// ที่เดียวที่คิดปี พ.ศ. — ต้องคิดตามเวลาไทย ไม่ใช่ UTC
// ใบที่แจ้งตี 1 วันที่ 1 ม.ค. (ไทย) = 31 ธ.ค. 18:00 UTC ต้องได้เลขใบของปีใหม่
const thaiYear = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' });

export const thaiBuddhistYear = (d: Date = new Date()): number => Number(thaiYear.format(d)) + 543;

export const formatTicketNo = (beYear: number, seq: number): string => `TK-${beYear}-${String(seq).padStart(6, '0')}`;
