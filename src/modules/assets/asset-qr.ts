import { toBuffer } from 'qrcode';

// QR เก็บแค่ลิงก์สั้น ๆ ไปหน้าสแกนของเว็บ ไม่ฝังข้อมูลครุภัณฑ์ลงในภาพ
// สติกเกอร์ติดไปแล้วแก้ไม่ได้ — ย้ายห้องหรือเปลี่ยนชื่อต้องแก้ที่ฐานข้อมูลได้โดยไม่ต้องพิมพ์ใหม่
// ใช้ qr_token (สุ่ม 128 บิต) ไม่ใช่ asset_code ที่ไล่เลขได้ทั้งหอ
export const scanUrl = (baseUrl: string, qrToken: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/app/scan/${encodeURIComponent(qrToken)}`;

// ระดับ Q ทนถูกบังได้ราว 25% ของภาพ — สติกเกอร์ในหอเลอะ ลอก และถูกขูดจริง (ของเดิมใช้ระดับเดียวกัน)
// scale 8 ≈ 2.5 ซม. ที่ 300 dpi พอให้มือถือทั่วไปสแกนติดจากระยะแขน
export const qrPng = (url: string): Promise<Buffer> =>
  toBuffer(url, { type: 'png', errorCorrectionLevel: 'Q', scale: 8, margin: 2 });
