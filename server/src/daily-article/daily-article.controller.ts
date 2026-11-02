import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { DailyArticle } from '../schemas/daily-article.schema';
import { DailyArticleService, beijingToday, EARLIEST_DATE } from './daily-article.service';
import { DailyArticleQueryDto } from './dto/daily-article-query.dto';

@Controller('daily-article')
export class DailyArticleController {
  constructor(private readonly dailyArticleService: DailyArticleService) {}

  /**
   * 当天文章：GET /api/daily-article
   * 指定日期：GET /api/daily-article?date=YYYY-MM-DD
   * 用查询参数而非 :date 路径参数——「今天」必须由服务器按北京时区计算，
   * date 缺省即今天，天然只有一份日期逻辑（也不存在与子路由的声明顺序冲突）。
   * 缺文章时按需生成入库（date 唯一 + single-flight，花费有上界，见技术方案 6.4）。
   */
  @Get()
  async getArticle(@Query() query: DailyArticleQueryDto) {
    const today = beijingToday();
    const date = query.date || today;

    // 日历真实性：'2026-02-30' 这类伪日期正则校不出来，回读比对兜底
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('date 不是有效的日历日期');
    }
    if (date > today) {
      throw new BadRequestException('暂无未来日期的文章');
    }
    if (date < EARLIEST_DATE) {
      throw new BadRequestException('该日期早于功能上线，没有文章');
    }

    const article = await this.dailyArticleService.getByDate(date);
    return this.toDetail(article, today);
  }

  /** 响应只暴露前端需要的字段；today 让前端展示「今天」徽标、禁用右翻，永不依赖手机本地时钟 */
  private toDetail(article: DailyArticle, today: string) {
    return {
      today,
      date: article.date,
      title: article.title,
      titleZh: article.titleZh,
      topic: article.topic,
      paragraphs: article.paragraphs,
      words: article.words,
    };
  }
}
