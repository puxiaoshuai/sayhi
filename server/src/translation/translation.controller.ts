import { Body, Controller, Post } from '@nestjs/common';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { TranslationService } from './translation.service';

class AnalyzeDto {
  @IsString()
  @IsNotEmpty({ message: '请输入要翻译的中文' })
  @MaxLength(200, { message: '文本过长，请控制在 200 字以内' })
  text: string;
}

@Controller('translation')
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

  /** 接收中文，调用大模型返回翻译、词汇、句型结构化数据 */
  @Post('analyze')
  analyze(@Body() dto: AnalyzeDto) {
    return this.translationService.analyze(dto.text);
  }
}
