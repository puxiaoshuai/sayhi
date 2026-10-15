import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

/**
 * 用户态 Guard：从 Authorization: Bearer <token> 解析 userId 挂到 request 上。
 * 只接受 type='user' 的 token（门禁 token type='pass' 不能访问用户数据）。
 */
@Injectable()
export class UserJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('缺少登录态，请重启小程序');
    }
    try {
      const payload = await this.jwtService.verifyAsync(token);
      if (payload?.type !== 'user' || !payload?.sub) {
        throw new Error();
      }
      (request as any).userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('登录态无效，请重启小程序');
    }
  }
}
