import { ValidateIf } from 'class-validator';

// ใช้แทน @IsOptional() ใน DTO ของ PATCH
// @IsOptional ข้ามการตรวจเมื่อค่าเป็น null ด้วย → PATCH { name: null } จะผ่านไปชน NOT NULL ที่ DB
// ตัวนี้ข้ามเฉพาะตอน "ไม่ได้ส่งฟิลด์มา" ส่วน null ยังถูกตรวจตามปกติ
export const IfPresent = (): PropertyDecorator => ValidateIf((_, value) => value !== undefined);

// ฟิลด์ที่ตั้งเป็น null ได้โดยเจตนา (เช่น room_id: null = ย้ายออกจากห้อง): ข้ามตัวตรวจที่เหลือเมื่อเป็น null หรือไม่ได้ส่งมา
export const Nullable = (): PropertyDecorator => ValidateIf((_, value) => value !== undefined && value !== null);
