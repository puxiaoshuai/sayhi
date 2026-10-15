import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * 朗读文本上限。整句翻译最多几十字符，200 留足余量；
 * 真正的目的是挡住异常超长输入把百炼的合成费用打上去（见技术方案 6.5）。
 */
const MAX_TEXT = 200;

export class SynthesizeDto {
  /** 待朗读的英文文本（单词或整句） */
  @IsString()
  @IsNotEmpty({ message: '朗读文本不能为空' })
  @MaxLength(MAX_TEXT, { message: '朗读文本过长' })
  text: string;

  // 刻意不接收 voice / rate：它们是服务端配置（TTS_VOICE 等），
  // 音色只由后端 .env 决定，避免客户端各传各的把缓存打散。
}
