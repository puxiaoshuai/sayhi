import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { User } from '../schemas/user.schema';

/** 门禁 token 有效期：30 分钟（见技术方案 6.6） */
const PASS_TOKEN_TTL_SECONDS = 30 * 60;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * 应用锁密码校验：比对 .env 中的 bcrypt 哈希，
   * 通过后签发 30 分钟有效的门禁 token（type='pass'）。
   */
  async verifyPassword(password: string) {
    const hash = process.env.ACCESS_PASSWORD_HASH;
    if (!hash) {
      throw new UnauthorizedException('服务端未配置访问密码（ACCESS_PASSWORD_HASH）');
    }
    const ok = await bcrypt.compare(password, hash);
    if (!ok) {
      throw new UnauthorizedException('密码错误');
    }
    const passToken = await this.jwtService.signAsync(
      { type: 'pass' },
      { expiresIn: PASS_TOKEN_TTL_SECONDS },
    );
    return {
      passToken,
      // 以服务端时间为准，前端据此判断 30 分钟内免输
      expiresAt: Date.now() + PASS_TOKEN_TTL_SECONDS * 1000,
    };
  }

  /**
   * 静默登录（见技术方案 6.3）：wx.login 的 code 换 openid，
   * 自动注册/登录，返回用户态 token（type='user'）。
   */
  async loginByCode(code: string) {
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (!appid || !secret) {
      throw new UnauthorizedException('服务端未配置微信 AppID/Secret');
    }

    let openid: string;
    try {
      const res = await axios.get(
        'https://api.weixin.qq.com/sns/jscode2session',
        {
          params: { appid, secret, js_code: code, grant_type: 'authorization_code' },
          timeout: 10_000,
        },
      );
      if (res.data?.errcode || !res.data?.openid) {
        throw new Error(res.data?.errmsg || 'code2session 失败');
      }
      openid = res.data.openid;
    } catch (e) {
      throw new UnauthorizedException('微信登录失败：' + e.message);
    }

    const user = await this.userModel.findOneAndUpdate(
      { openid },
      {},
      { new: true, upsert: true },
    );

    const token = await this.jwtService.signAsync({
      type: 'user',
      sub: String(user._id),
    });
    return { token, userId: String(user._id) };
  }

  /** 校验用户态 token，返回 userId；供 Guard 与需要手动校验的场景使用 */
  async verifyUserToken(token: string): Promise<string> {
    try {
      const payload = await this.jwtService.verifyAsync(token);
      if (payload?.type !== 'user' || !payload?.sub) {
        throw new Error('非用户态 token');
      }
      return payload.sub as string;
    } catch {
      throw new UnauthorizedException('登录态无效，请重启小程序');
    }
  }
}
