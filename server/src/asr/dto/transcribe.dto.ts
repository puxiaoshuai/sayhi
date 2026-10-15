import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** 音频格式白名单，与百炼支持的格式对齐（见技术方案 6.5 的 /api/asr） */
export const ASR_FORMATS = ['mp3', 'wav', 'aac', 'opus', 'amr', 'pcm'] as const;

/**
 * 百炼硬上限：音频 base64 编码后总量 ≤ 10MB。
 * base64 是纯 ASCII，字符数≈字节数，故直接按字符数卡口。
 */
const MAX_BASE64_CHARS = 10 * 1024 * 1024;

export class TranscribeDto {
  /**
   * 录音文件的 base64 字符串。是否带 data: 前缀都接受，由 service 统一清洗。
   * 不做 base64 正则校验——10MB 上跑正则会打满 CPU，非法串交给百炼返回 400。
   */
  @IsString()
  @IsNotEmpty({ message: '音频数据不能为空' })
  @MaxLength(MAX_BASE64_CHARS, { message: '录音过长，请缩短后重试' })
  audio: string;

  /** 与录音文件真实格式一致，白名单外直接 400 */
  @IsOptional()
  @IsIn([...ASR_FORMATS], { message: '不支持的音频格式' })
  format?: string = 'mp3';

  /** 待识别语种提示，最多 4 个；不传则由模型自动识别 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  languageHints?: string[];
}
