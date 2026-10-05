import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AppException } from '../../common/errors/domain-errors';
import { User } from '../../database/entities';
import { toUserView } from '../users/user.view';
import { TokenResponse } from './auth.dto';
import { OtpService } from './otp.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
  ) {}

  async verifyCode(email: string, code: string): Promise<TokenResponse> {
    await this.otp.consumeCode(email, code);

    // auto-provision: อีเมลมหาวิทยาลัยที่ยืนยันได้แต่ยังไม่มีบัญชี → student ที่ยังไม่มีห้อง
    // บัญชีที่ Admin สร้างไว้ก่อน (ช่าง/Staff) ชน partial unique แล้วไม่ถูกแตะ จึงคง role เดิม
    await this.dataSource.query(
      `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) WHERE deleted_at IS NULL DO NOTHING`,
      [email],
    );
    const user = await this.dataSource.getRepository(User).findOneOrFail({ where: { email } });

    if (!user.isActive) {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'ACCOUNT_DISABLED', 'บัญชีนี้ถูกระงับการใช้งาน');
    }

    // token มีแค่ sub — ห้ามใส่ role: guard อ่าน role จาก DB ทุก request เพื่อให้การเปลี่ยน role มีผลทันที
    const access_token = await this.jwt.signAsync({ sub: user.id });
    return { access_token, token_type: 'bearer', user: toUserView(user) };
  }
}
