import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { Env } from '../../config/env';

// e2e แทนคลาสนี้ด้วยตัวปลอมที่เก็บรหัสไว้ให้เทสอ่าน — เทสไม่ส่งเมลจริง
@Injectable()
export class MailService {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transport = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('MAILPIT_SMTP_PORT', { infer: true }),
      secure: false,
    });
  }

  async sendLoginCode(email: string, code: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: `รหัสเข้าสู่ระบบแจ้งซ่อมหอพัก: ${code}`,
      text: `รหัสเข้าสู่ระบบของคุณคือ ${code}\nรหัสมีอายุ 10 นาที และใช้ได้ครั้งเดียว\nถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร`,
    });
  }
}
