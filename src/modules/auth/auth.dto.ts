import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { IsUniversityEmail } from '../../common/validation/university-email';
import { UserView } from '../users/user.view';

export class RequestCodeDto {
  @ApiProperty({ example: 'demo.s0001@kmitl.ac.th' })
  @IsUniversityEmail()
  email: string;
}

export class VerifyCodeDto {
  @ApiProperty({ example: 'demo.s0001@kmitl.ac.th' })
  @IsUniversityEmail()
  email: string;

  @ApiProperty({ example: '042917', description: 'รหัส 6 หลักจากอีเมล' })
  @Matches(/^\d{6}$/, { message: 'รหัสต้องเป็นตัวเลข 6 หลัก' })
  code: string;
}

export class RequestCodeResponse {
  @ApiProperty({ example: 'ถ้าอีเมลนี้ใช้งานได้ ระบบได้ส่งรหัส 6 หลักไปให้แล้ว' })
  message: string;
}

export class TokenResponse {
  @ApiProperty()
  access_token: string;

  @ApiProperty({ example: 'bearer' })
  token_type: 'bearer';

  @ApiProperty({ type: UserView })
  user: UserView;
}
