import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AsrService } from './asr.service';
import { TranscribeDto } from './dto/transcribe.dto';
import { UserJwtGuard } from '../auth/guards/user-jwt.guard';

/**
 * 语音识别接口（见技术方案 6.5 的 /api/asr）。
 * 加登录态闸门，避免后端暴露后被人刷爆百炼的付费额度。
 */
@Controller('asr')
@UseGuards(UserJwtGuard)
export class AsrController {
  constructor(private readonly asrService: AsrService) {}

  /** 音频 base64 → 整段识别文本 */
  @Post('transcribe')
  transcribe(@Body() dto: TranscribeDto) {
    return this.asrService.transcribe(dto.audio, dto.format, dto.languageHints);
  }
}
