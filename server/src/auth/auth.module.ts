import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserJwtGuard } from './guards/user-jwt.guard';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod',
      signOptions: { expiresIn: '30d' }, // 用户态默认 30 天；门禁 token 单独传 expiresIn
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UserJwtGuard],
  exports: [UserJwtGuard],
})
export class AuthModule {}
