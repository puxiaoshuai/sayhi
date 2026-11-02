import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DailyArticle, DailyParagraph, DailyWord } from '../schemas/daily-article.schema';
import { LlmService } from '../common/llm.service';
import { extractJson } from '../common/json.util';

/**
 * 每日一文生成 Prompt（见技术方案 6.1：结构化输出 + 硬性要求写进 prompt）。
 * 题材由调用方通过补充提示传入（题材轮换表见 DAILY_TOPICS），正文不写死。
 */
const DAILY_SYSTEM_PROMPT = `你是英语每日阅读内容生成器，为中文母语的英语学习者生成一篇可朗读学习的短文。
必须且只能返回合法 JSON，不含任何 markdown 标记或多余文本。结构：
{
  "title": "英文标题（10 词以内）",
  "titleZh": "中文标题",
  "paragraphs": [
    { "en": "英文段落", "zh": "该段完整通顺的中文翻译" }
  ],
  "words": [
    { "word": "重点单词或短语", "phonetic": "美式音标如 /rɪˈzʌlt/", "pos": "词性缩写（名词统一用 n.）", "meaning": "中文释义" }
  ]
}
硬性要求：
1. 正文 180~260 词、4~6 段、每段 1~3 句；语言地道自然，难度约 CET-4；超出该难度的词必须收录进 words 讲解
2. words 6~8 个，必须是正文中真实出现的重点词/短语，禁止收录正文没有的词
3. 题材严格限定在提示给出的主题内，观点积极、信息具体，禁止空话套话和说教
4. 所有字段非空；正文与标题禁止 markdown 标记和编号列表符号`;

/** 题材轮换表：每天按日期确定性轮换，同一天重试也得到同题材 */
const DAILY_TOPICS = [
  '科技', '健康', '职场', '旅行', '教育', '自然', '文化',
  '美食', '体育', '心理', '财经', '社会观察', '人物故事', '科学新知',
];

/** 功能上线日：早于它的日期没有文章，直接拒绝（封顶历史回翻的生成花费）。controller 的入参校验也要用 */
export const EARLIEST_DATE = '2026-11-02';

/** 生成失败后的冷却期：冷却内的请求直接 503，不再打 LLM（防公开接口被刷烧钱） */
const RETRY_COOLDOWN_MS = 60_000;

/**
 * 服务器当前北京日期（'YYYY-MM-DD'）。
 * 用 Intl 显式指定时区而非依赖服务器本地时区——
 * 本地开发在 Windows、线上在 OpenCloudOS，时区配置不可控。
 */
export function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // en-CA 的格式化结果就是 YYYY-MM-DD
}

/** 题材轮换：按 UTC 天数取模，同一日期永远同一题材（确定性，重生成一致） */
function topicFor(date: string): string {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return DAILY_TOPICS[days % DAILY_TOPICS.length];
}

@Injectable()
export class DailyArticleService {
  private readonly logger = new Logger(DailyArticleService.name);

  /** single-flight：同一日期并发请求共享同一个生成 Promise（见技术方案 6.4） */
  private readonly generating = new Map<string, Promise<DailyArticle>>();

  /** 各日期最近一次生成失败的时间戳，冷却期内直接拒绝 */
  private readonly failedAt = new Map<string, number>();

  constructor(
    @InjectModel(DailyArticle.name) private readonly articleModel: Model<DailyArticle>,
    private readonly llm: LlmService,
  ) {}

  /**
   * 每天 06:00（北京时间）预生成当天文章，让用户打开即读不等待。
   * 错过不补跑（pm2 reload 跨 6 点等场景），补偿就是读接口的按需兜底——
   * 两者走同一条 getByDate，代码路径唯一。
   */
  @Cron('0 0 6 * * *', { name: 'daily-article', timeZone: 'Asia/Shanghai' })
  async handleDailyCron() {
    try {
      const article = await this.getByDate(beijingToday());
      this.logger.log(`每日一文已生成：${article.date}（${article.topic}）`);
    } catch (e) {
      this.logger.warn(`定时生成失败（用户首次访问时会兜底重试）：${(e as Error).message}`);
    }
  }

  /**
   * 按日期取文章：查库命中直接返回（毫秒级、零 API 成本）；
   * 未命中走「生成→清洗→入库」，结果按 date 唯一索引永久复用。
   */
  async getByDate(date: string): Promise<DailyArticle> {
    const cached = await this.articleModel.findOne({ date }).lean<DailyArticle>();
    if (cached) return cached;

    const lastFail = this.failedAt.get(date) ?? 0;
    if (Date.now() - lastFail < RETRY_COOLDOWN_MS) {
      throw new ServiceUnavailableException('文章生成中，请稍后重试');
    }

    if (!this.generating.has(date)) {
      const p = this.generateAndSave(date)
        .catch((e) => {
          this.failedAt.set(date, Date.now());
          throw e;
        })
        .finally(() => this.generating.delete(date));
      this.generating.set(date, p);
    }
    return this.generating.get(date)!;
  }

  private async generateAndSave(date: string): Promise<DailyArticle> {
    const raw = await this.llm.chatJsonWithRetry(
      DAILY_SYSTEM_PROMPT,
      `日期：${date}。今日主题：${topicFor(date)}。请生成今天的短文。`,
    );
    const parsed = extractJson<{
      title?: string;
      titleZh?: string;
      paragraphs?: DailyParagraph[];
      words?: DailyWord[];
    }>(raw);

    const title = String(parsed.title || '').trim();
    const titleZh = String(parsed.titleZh || '').trim();
    const paragraphs = this.sanitizeParagraphs(parsed.paragraphs);
    const words = this.sanitizeWords(parsed.words);
    if (!title || !titleZh || paragraphs.length < 3 || words.length < 4) {
      throw new ServiceUnavailableException('文章生成不完整，请稍后重试');
    }

    // $setOnInsert + date 唯一索引：同一日期只写一次。
    // 将来若开多实例并发插入撞 unique(11000)，此处 upsert 天然只留一份，其余请求回读即可。
    return this.articleModel
      .findOneAndUpdate(
        { date },
        {
          $setOnInsert: {
            date,
            title,
            titleZh,
            topic: topicFor(date),
            paragraphs,
            words,
          },
        },
        { upsert: true, new: true },
      )
      .lean<DailyArticle>()
      .exec() as unknown as Promise<DailyArticle>;
  }

  private sanitizeParagraphs(list?: DailyParagraph[]): DailyParagraph[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => p && typeof p.en === 'string' && p.en.trim())
      .map((p) => ({
        en: String(p.en).trim(),
        zh: String(p.zh || '').trim(),
      }));
  }

  private sanitizeWords(list?: DailyWord[]): DailyWord[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter((w) => w && typeof w.word === 'string' && w.word.trim())
      .map((w) => ({
        word: String(w.word).trim(),
        phonetic: String(w.phonetic || '').trim(),
        pos: String(w.pos || 'n.').trim(),
        meaning: String(w.meaning || '').trim(),
      }));
  }
}
