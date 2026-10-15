import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { TtsService } from './tts.service';
import { SynthesizeDto } from './dto/synthesize.dto';
import { UserJwtGuard } from '../auth/guards/user-jwt.guard';

/**
 * 语音合成接口（见技术方案 6.5 的 /api/tts）。
 * 同 ASR 一样加登录态闸门，避免后端暴露后被人刷爆百炼的付费额度。
 */
@Controller('tts')
@UseGuards(UserJwtGuard)
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

  /**
   * 当前音色配置。前端必须拿它拼本地缓存 key——
   * 音色是服务端可变常量，前端不问这一次，就无从知道本地那份音频是不是旧音色的。
   */
  @Get('config')
  config() {
    return this.ttsService.publicConfig;
  }

  /** 文本 → base64 音频（与 /asr/transcribe 的 base64 往返风格保持一致） */
  @Post()
  async synthesize(@Body() dto: SynthesizeDto) {
    const { buffer, format, cached } = await this.ttsService.synthesize(dto.text);
    return { audio: buffer.toString('base64'), format, cached };
  }
}
