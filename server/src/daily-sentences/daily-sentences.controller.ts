import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { DailySentenceDoc } from '../schemas/daily-sentence.schema';
import { DailySentencesService, beijingToday, EARLIEST_DATE } from './daily-sentences.service';
import { DailySentencesQueryDto } from './dto/daily-sentences-query.dto';

@Controller('daily-sentences')
export class DailySentencesController {
  constructor(private readonly dailySentencesService: DailySentencesService) {}

  /**
   * 当天口语：GET /api/daily-sentences
   * 指定日期：GET /api/daily-sentences?date=YYYY-MM-DD
   * 用查询参数而非 :date 路径参数——「今天」必须由服务器按北京时区计算，
   * date 缺省即今天，天然只有一份日期逻辑（也不存在与子路由的声明顺序冲突）。
   * 缺数据时按需生成入库（date 唯一 + single-flight，花费有上界，见技术方案 6.4）。
   */
  @Get()
  async getSentences(@Query() query: DailySentencesQueryDto) {
    const today = beijingToday();
    const date = query.date || today;

    // 日历真实性：'2026-02-30' 这类伪日期正则校不出来，回读比对兜底
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('date 不是有效的日历日期');
    }
    if (date > today) {
      throw new BadRequestException('暂无未来日期的口语');
    }
    if (date < EARLIEST_DATE) {
      throw new BadRequestException('该日期早于功能上线，没有口语数据');
    }

    const daily = await this.dailySentencesService.getByDate(date);
    return this.toDetail(daily, today);
  }

  /** 响应只暴露前端需要的字段；today 让前端展示「今天」徽标、禁用右翻，永不依赖手机本地时钟 */
  private toDetail(daily: DailySentenceDoc, today: string) {
    return {
      today,
      date: daily.date,
      sceneKey: daily.sceneKey,
      sceneName: daily.sceneName,
      sceneEmoji: daily.sceneEmoji,
      sentences: daily.sentences,
    };
  }
}
