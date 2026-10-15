import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 收藏列表查询参数：游标分页 + 关键词（见技术方案 4.2） */
export class ListFavoritesDto {
  /** 上一页最后一条的游标；不传表示取第一页 */
  @IsOptional()
  @IsString()
  cursor?: string;

  /** 每页条数，默认 20（见 service 的 DEFAULT_LIMIT）；封顶 50，防止被要求一次拉全量 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1)
  @Max(50, { message: 'limit 最大 50' })
  limit?: number;

  /** 关键词：同时匹配中文原文与英文翻译，不区分大小写 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
