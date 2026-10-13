import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { OtpService } from './otp.service';

// Global เพราะ JwtAuthGuard (ลงทะเบียนเป็น APP_GUARD ใน AppModule) ต้องใช้ JwtService
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, MailService],
  // MailService ถูก export เพราะ workflow ใช้ส่งเมลแจ้งผลซ่อม (DESIGN 6.10)
  // โมดูลนี้ @Global อยู่แล้ว การ export จึงพอให้ทั้งแอปใช้ตัวเดียวกัน (e2e override ตัวนี้ตัวเดียว)
  exports: [JwtModule, MailService],
})
export class AuthModule {}
