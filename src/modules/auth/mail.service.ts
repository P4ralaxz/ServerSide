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

  // ส่งทีละคน ไม่รวมผู้รับในฉบับเดียว — รูมเมทไม่ควรเห็นอีเมลของกันและกัน
  async sendTicketResolved(email: string, info: ResolvedMailInfo): Promise<void> {
    const deadline =
      info.autoCloseAt === null
        ? 'ใบนี้มีคนแย้งว่ายังไม่หาย เจ้าหน้าที่จะเป็นผู้ตัดสิน'
        : `ถ้าไม่ยืนยันภายใน ${info.autoCloseAt.toISOString()} ระบบจะปิดใบให้`;
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: `ช่างแจ้งว่าซ่อมเสร็จแล้ว: ${info.ticketNo}`,
      text: [
        `ใบแจ้งซ่อม ${info.ticketNo} — ${info.assetName} · ${info.where}`,
        info.note ? `บันทึกของช่าง: ${info.note}` : 'ช่างไม่ได้ฝากบันทึกไว้',
        'กรุณาตรวจผลแล้วกดยืนยัน หรือส่งกลับให้ช่างถ้ายังไม่หาย',
        deadline,
        info.link,
      ].join('\n'),
    });
  }

  // ใบกลับไปหาช่างคนเดิมโดยไม่ผ่าน Staff ก่อน (DESIGN 6.10) — เมลนี้คือทางเดียวที่ช่างจะรู้ตัว
  async sendTicketReopened(email: string, info: ReopenedMailInfo): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: `ผู้พักแจ้งว่ายังไม่หาย: ${info.ticketNo} (ครั้งที่ ${info.reopenCount})`,
      text: [
        `ใบแจ้งซ่อม ${info.ticketNo} — ${info.assetName} · ${info.where}`,
        `อาการที่ยังเป็นอยู่: ${info.note}`,
        `ใบกลับไปที่ขั้นมอบหมายแล้ว ช่างคนเดิมยังเป็นผู้รับงาน (ส่งกลับครั้งที่ ${info.reopenCount})`,
        info.link,
      ].join('\n'),
    });
  }
}

export interface ResolvedMailInfo {
  ticketNo: string;
  assetName: string;
  where: string;
  note: string | null;
  autoCloseAt: Date | null;
  link: string;
}

export interface ReopenedMailInfo {
  ticketNo: string;
  assetName: string;
  where: string;
  note: string;
  reopenCount: number;
  link: string;
}
