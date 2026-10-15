import { Module } from '@nestjs/common';
import { AsrController } from './asr.controller';
import { AsrService } from './asr.service';

// 不 import AuthModule：JwtModule 是 global 的，UserJwtGuard 可直接用（同 favorites）
@Module({
  controllers: [AsrController],
  providers: [AsrService],
})
export class AsrModule {}
