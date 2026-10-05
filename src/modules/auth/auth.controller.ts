import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../../common/auth/decorators';
import { User } from '../../database/entities';
import { toUserView, UserView } from '../users/user.view';
import { RequestCodeDto, RequestCodeResponse, TokenResponse, VerifyCodeDto } from './auth.dto';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

export const VERIFY_PER_IP_PER_HOUR = 60;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Post('request-code')
  @HttpCode(202)
  @ApiOperation({ summary: 'ขอรหัส OTP 6 หลักทางอีเมล (อายุ 10 นาที)' })
  @ApiAcceptedResponse({ type: RequestCodeResponse, description: 'ตอบข้อความเดียวกันเสมอ ไม่ว่าอีเมลจะมีบัญชีหรือไม่' })
  @ApiBadRequestResponse({ description: 'ไม่ใช่อีเมล @kmitl.ac.th' })
  @ApiTooManyRequestsResponse({ description: 'ต่ออีเมล 1 ครั้ง/60 วินาที และ 5 ครั้ง/ชม. · ต่อ IP 30 ครั้ง/ชม.' })
  async requestCode(@Body() dto: RequestCodeDto, @Ip() ip: string): Promise<RequestCodeResponse> {
    await this.otp.requestCode(dto.email, ip || null);
    // ข้อความเดียวกันทุกกรณี — ถ้าต่างกันระหว่างอีเมลที่มี/ไม่มีบัญชี จะใช้ไล่หารายชื่อผู้ใช้ได้
    return { message: 'ถ้าอีเมลนี้ใช้งานได้ ระบบได้ส่งรหัส 6 หลักไปให้แล้ว' };
  }

  @Public()
  @Post('verify-code')
  @HttpCode(200)
  // ด่านรองต่อ IP — ด่านหลักคือ attempts ต่อรหัสใน OtpService
  @Throttle({ default: { limit: VERIFY_PER_IP_PER_HOUR, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'ยืนยันรหัส OTP แล้วรับ JWT (อายุ 8 ชม.)' })
  @ApiOkResponse({ type: TokenResponse })
  @ApiBadRequestResponse({ description: 'รูปแบบอีเมลหรือรหัสไม่ถูกต้อง' })
  @ApiUnauthorizedResponse({ description: 'รหัสผิด หมดอายุ ถูกใช้ไปแล้ว หรือบัญชีถูกระงับ' })
  @ApiTooManyRequestsResponse({ description: 'รหัสนี้ลองผิดครบ 5 ครั้งแล้ว หรือ IP นี้ยืนยันเกิน 60 ครั้ง/ชม.' })
  verifyCode(@Body() dto: VerifyCodeDto): Promise<TokenResponse> {
    return this.auth.verifyCode(dto.email, dto.code);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ข้อมูลผู้ใช้ของ token นี้ (อ่านจาก DB ทุกครั้ง)' })
  @ApiOkResponse({ type: UserView })
  @ApiUnauthorizedResponse({ description: 'ไม่มี token, token ใช้ไม่ได้, หรือบัญชีถูกระงับ/ลบ' })
  me(@CurrentUser() user: User): UserView {
    return toUserView(user);
  }
}
