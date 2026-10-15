import { Module } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';

// 不 import AuthModule：JwtModule 是 global 的，UserJwtGuard 可直接用（同 asr / favorites）
@Module({
  controllers: [TtsController],
  providers: [TtsService],
})
export class TtsModule {}
