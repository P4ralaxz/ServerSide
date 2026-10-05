import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, Matches } from 'class-validator';

// โดเมนต้องเป็น kmitl.ac.th ตรงตัว — subdomain อย่าง student.kmitl.ac.th ไม่นับ (ตรงกับ ck_users_email_domain ที่ DB)
const UNIVERSITY_EMAIL = /^[^@\s]+@kmitl\.ac\.th$/;

// ตัดช่องว่างและแปลงเป็นตัวเล็กก่อนตรวจ: คอลัมน์เป็น citext อยู่แล้ว แต่ HMAC ของ OTP ผูกกับตัวอีเมล
// ถ้าไม่ normalize ที่เดียวตรงนี้ ขอรหัสด้วยตัวใหญ่แล้วยืนยันด้วยตัวเล็กจะได้ hash คนละค่า
export const IsUniversityEmail = (): PropertyDecorator =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)),
    IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' }),
    Matches(UNIVERSITY_EMAIL, { message: 'ต้องเป็นอีเมล @kmitl.ac.th เท่านั้น' }),
  );
