-- ช่างไม่ผูกห้องพัก (DESIGN 4.4)
-- API ตอบ 400 ก่อนถึง DB อยู่แล้ว — CHECK นี้เป็นด่านสุดท้ายเผื่อโค้ดพลาดหรือมีคนแก้ข้อมูลตรง
-- แยกเป็น 002 เพราะ 001 ถูกรันไปแล้วบนฐานข้อมูลที่มีอยู่
ALTER TABLE users
  ADD CONSTRAINT ck_technician_no_room CHECK (role <> 'technician' OR room_id IS NULL);
