import { Controller, Post, Body } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService } from './auth.service';

class VerifyPasswordDto {
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}

class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'code 不能为空' })
  code: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 应用锁：校验访问密码，通过后返回 30 分钟门禁 token（见技术方案 6.6） */
  @Post('verify-password')
  verifyPassword(@Body() dto: VerifyPasswordDto) {
    return this.authService.verifyPassword(dto.password);
  }

  /** 静默登录：wx.login code 换 openid，自动注册（见技术方案 6.3） */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.loginByCode(dto.code);
  }
}
