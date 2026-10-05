// ตัวเลขของกฎทางธุรกิจ — อยู่ที่เดียว service และเทสอ้างจากที่นี่ ห้ามเขียนเลขซ้ำในโค้ด

// แจ้งหลายรายการในคำขอเดียว = หลายใบที่ batch_id เดียวกัน (กฎข้อ 1)
export const MAX_ITEMS_PER_BATCH = 10;

// โควตา: ใบที่ยังเปิดค้างของผู้แจ้ง (นับตาม OPEN_STATUSES รวมใบส่วนกลาง) — staff/admin ไม่มีโควตา
export const OPEN_TICKET_QUOTA = 10;

// report_count เกินค่านี้ (= คนที่ 11) → ยกเป็น urgent อัตโนมัติ ครั้งเดียวต่อใบ
export const AUTO_URGENT_REPORT_COUNT = 10;

export const TICKET_LIST_DEFAULT_LIMIT = 50;
export const TICKET_LIST_MAX_LIMIT = 100;
