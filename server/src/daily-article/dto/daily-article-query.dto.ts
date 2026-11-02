import { IsOptional, Matches } from 'class-validator';

export class DailyArticleQueryDto {
  /** 不传即今天（由服务器按北京时区计算，前端永不自算今天） */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 格式须为 YYYY-MM-DD' })
  date?: string;
}
