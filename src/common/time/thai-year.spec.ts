import { formatTicketNo, thaiBuddhistYear } from './thai-year';

describe('thaiBuddhistYear', () => {
  it('ตี 1 ของวันที่ 1 ม.ค. เวลาไทย (ยังเป็น 31 ธ.ค. ใน UTC) ต้องได้ปีใหม่', () => {
    expect(thaiBuddhistYear(new Date('2026-12-31T18:00:00Z'))).toBe(2570);
  });

  it('16:59 UTC ของ 31 ธ.ค. ยังเป็นปีเก่าในเวลาไทย', () => {
    expect(thaiBuddhistYear(new Date('2026-12-31T16:59:59Z'))).toBe(2569);
  });

  it('กลางปีได้ ค.ศ. + 543', () => {
    expect(thaiBuddhistYear(new Date('2026-10-05T03:00:00Z'))).toBe(2569);
  });
});

describe('formatTicketNo', () => {
  it('pad ลำดับ 6 หลัก', () => {
    expect(formatTicketNo(2569, 123)).toBe('TK-2569-000123');
  });
});
