// ต้อง import เป็นบรรทัดแรกของทุก entrypoint (main / data-source / seed / jest)
// node-postgres แปลงเวลาตามโซนของ process — ถ้าเครื่องตั้งเป็นเวลาไทยแล้วมีคอลัมน์ที่ไม่มีโซนหลุดมา
// จะเลื่อน 7 ชั่วโมงเงียบ ๆ จึงตรึงไว้ที่ UTC ก่อนมี Date ตัวแรกเกิดขึ้น
process.env.TZ = 'UTC';
