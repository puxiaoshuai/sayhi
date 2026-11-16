import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DailySentenceDoc,
  DailySentenceItem,
} from '../schemas/daily-sentence.schema';
import { LlmService } from '../common/llm.service';
import { extractJson } from '../common/json.util';

/**
 * 每日口语生成 Prompt（见技术方案 6.1：结构化输出 + 硬性要求写进 prompt）。
 * 场景由调用方通过补充提示传入（场景轮换表见 DAILY_SCENES），
 * LLM 只负责句子本身，场景名/emoji 以轮换表为准——确定性更强。
 */
const DAILY_SENTENCES_SYSTEM_PROMPT = `你是英语口语教练，为中文母语的英语学习者生成「每日口语」：围绕一个指定生活场景的 10 句高频实用口语。
必须且只能返回合法 JSON，不含任何 markdown 标记或多余文本。结构：
{
  "sentences": [
    { "en": "英文口语句子", "zh": "完整通顺的中文翻译", "situation": "何时用，10 字以内" }
  ]
}
硬性要求：
1. sentences 恰好 10 句，难度由浅入深：第 1~2 句开场寒暄或引起对方注意，第 3~7 句该场景的核心沟通表达（点单/描述需求/提出问题等），第 8~9 句确认细节、询问价格或付款，第 10 句道别或收尾
2. 全部是地道自然的口语（母语者真的会这么说），禁止书面语、教科书腔和中式英语；每句 6~15 个英文单词
3. situation 说明使用时机（如「点单时说」「嫌太甜时」），10 字以内
4. 场景严格限定在提示给定的主题内，10 句串起来是同一场景下一次完整交流的自然脉络
5. 所有字段非空；禁止 markdown 标记和编号`;

/** 场景轮换表项：prompt 是给 LLM 的场景要点提示 */
interface DailyScene {
  key: string;
  name: string;
  emoji: string;
  prompt: string;
}

/**
 * 场景轮换表：每天按日期确定性轮换（30 天一轮回），
 * 同一天重试也得到同场景。覆盖高频生活口语场景。
 */
const DAILY_SCENES: DailyScene[] = [
  { key: 'coffee', name: '咖啡店点单', emoji: '☕', prompt: '点单、定制糖度奶类、加购、取餐、会员优惠' },
  { key: 'restaurant', name: '餐厅用餐', emoji: '🍽️', prompt: '等位、看菜单、点菜、忌口说明、催菜、买单打包' },
  { key: 'airport', name: '机场值机', emoji: '✈️', prompt: '值机托运、选座、安检、登机口询问、转机' },
  { key: 'customs', name: '海关入境', emoji: '🛃', prompt: '入境问答、申报物品、行李检查、旅游目的说明' },
  { key: 'hotel', name: '酒店入住', emoji: '🏨', prompt: '预订确认、入住办理、房型要求、设施询问、退房' },
  { key: 'taxi', name: '打车出行', emoji: '🚕', prompt: '招呼上车、说目的地、指路、赶时间、付款小费' },
  { key: 'subway', name: '地铁公交', emoji: '🚇', prompt: '买票刷卡、问线路换乘、确认到站、求助扫码' },
  { key: 'directions', name: '问路指路', emoji: '🗺️', prompt: '礼貌开口问路、描述目的地、听懂指路、确认步行时间' },
  { key: 'shopping', name: '商场购物', emoji: '🛍️', prompt: '招呼店员、询问尺码颜色、试穿、砍价、退换货' },
  { key: 'supermarket', name: '超市采购', emoji: '🛒', prompt: '找商品、询问产地保质期、称重、自助结账、要袋子' },
  { key: 'bank', name: '银行办卡', emoji: '💳', prompt: '开卡咨询、填表、设置密码、换汇、转账汇款' },
  { key: 'pharmacy', name: '药店买药', emoji: '💊', prompt: '描述症状、询问用法用量、处方要求、非处方替代' },
  { key: 'hospital', name: '医院就诊', emoji: '🏥', prompt: '挂号、描述症状病史、理解医嘱、预约复诊' },
  { key: 'gym', name: '健身房', emoji: '🏋️', prompt: '咨询办卡、约课、请教练指导、使用器械、请假改期' },
  { key: 'haircut', name: '理发店', emoji: '💇', prompt: '描述发型需求、修剪长度、烫染询问、表达不满' },
  { key: 'laundry', name: '洗衣店', emoji: '🧺', prompt: '送洗、说明面料污渍、询问取件时间、收费争议' },
  { key: 'phone-call', name: '电话客服', emoji: '📞', prompt: '转人工、描述问题、查询订单、投诉、要求回访' },
  { key: 'delivery', name: '快递物流', emoji: '📦', prompt: '寄件收件、查询物流、破损理赔、改地址、放驿站' },
  { key: 'renting', name: '租房看房', emoji: '🏠', prompt: '预约看房、询问房租水电、家具家电、签约、报修' },
  { key: 'vet', name: '宠物医院', emoji: '🐾', prompt: '描述宠物症状、疫苗接种、体检、术后护理' },
  { key: 'camping', name: '露营户外', emoji: '⛺', prompt: '预约营地、租装备、询问设施、天气安全、求助' },
  { key: 'photo-help', name: '请人拍照', emoji: '📷', prompt: '礼貌求助拍照、指导构图角度、连拍请求、道谢' },
  { key: 'cinema', name: '电影院', emoji: '🎬', prompt: '选场次座位、买票零食、换座、散场取物' },
  { key: 'library', name: '图书馆', emoji: '📚', prompt: '办证、查找借阅、续借、逾期说明、自习占位' },
  { key: 'meeting', name: '职场开会', emoji: '💼', prompt: '开场主持、表达观点、打断澄清、认领任务、总结' },
  { key: 'interview', name: '求职面试', emoji: '👔', prompt: '自我介绍、经历陈述、反问环节、薪资谈判、跟进结果' },
  { key: 'icebreaking', name: '社交破冰', emoji: '🤝', prompt: '初次见面开场、找共同话题、赞美回应、交换联系方式' },
  { key: 'weather-talk', name: '聊天气', emoji: '🌤️', prompt: '寒暄天气、天气预报、极端天气关心、顺势邀约' },
  { key: 'invitation', name: '邀约赴约', emoji: '🍻', prompt: '发出邀请、敲定时间地点、改期婉拒、买单致谢' },
  { key: 'lost-items', name: '丢失求助', emoji: '🔍', prompt: '挂失寻物、描述特征、询问进展、感谢帮助' },
];

/** 功能上线日：早于它的日期没有数据，直接拒绝（封顶历史回翻的生成花费）。controller 的入参校验也要用 */
export const EARLIEST_DATE = '2026-11-16';

/** 生成失败后的冷却期：冷却内的请求直接 503，不再打 LLM（防公开接口被刷烧钱） */
const RETRY_COOLDOWN_MS = 60_000;

/** 一天的句子数量：恰好 10 句，少一句都算生成失败（入库后永久复用，不容错） */
const SENTENCE_COUNT = 10;

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

/** 场景轮换：按 UTC 天数取模，同一日期永远同一场景（确定性，重生成一致） */
function sceneFor(date: string): DailyScene {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return DAILY_SCENES[days % DAILY_SCENES.length];
}

@Injectable()
export class DailySentencesService {
  private readonly logger = new Logger(DailySentencesService.name);

  /** single-flight：同一日期并发请求共享同一个生成 Promise（见技术方案 6.4） */
  private readonly generating = new Map<string, Promise<DailySentenceDoc>>();

  /** 各日期最近一次生成失败的时间戳，冷却期内直接拒绝 */
  private readonly failedAt = new Map<string, number>();

  constructor(
    @InjectModel(DailySentenceDoc.name)
    private readonly sentenceModel: Model<DailySentenceDoc>,
    private readonly llm: LlmService,
  ) {}

  /**
   * 每天 06:00（北京时间）预生成当天口语，让用户打开即看不等待。
   * 错过不补跑（pm2 reload 跨 6 点等场景），补偿就是读接口的按需兜底——
   * 两者走同一条 getByDate，代码路径唯一。
   */
  @Cron('0 0 6 * * *', { name: 'daily-sentences', timeZone: 'Asia/Shanghai' })
  async handleDailyCron() {
    try {
      const daily = await this.getByDate(beijingToday());
      this.logger.log(
        `每日口语已生成：${daily.date}（${daily.sceneEmoji} ${daily.sceneName}，${daily.sentences.length} 句）`,
      );
    } catch (e) {
      this.logger.warn(`定时生成失败（用户首次访问时会兜底重试）：${(e as Error).message}`);
    }
  }

  /**
   * 按日期取口语：查库命中直接返回（毫秒级、零 API 成本）；
   * 未命中走「生成→清洗→入库」，结果按 date 唯一索引永久复用。
   */
  async getByDate(date: string): Promise<DailySentenceDoc> {
    const cached = await this.sentenceModel.findOne({ date }).lean<DailySentenceDoc>();
    if (cached) return cached;

    const lastFail = this.failedAt.get(date) ?? 0;
    if (Date.now() - lastFail < RETRY_COOLDOWN_MS) {
      throw new ServiceUnavailableException('口语生成中，请稍后重试');
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

  private async generateAndSave(date: string): Promise<DailySentenceDoc> {
    const scene = sceneFor(date);
    const raw = await this.llm.chatJsonWithRetry(
      DAILY_SENTENCES_SYSTEM_PROMPT,
      `日期：${date}。今日场景：${scene.emoji} ${scene.name}（要点：${scene.prompt}）。请生成今天的 10 句口语。`,
    );
    const parsed = extractJson<{ sentences?: DailySentenceItem[] }>(raw);

    const sentences = this.sanitizeSentences(parsed.sentences);
    // 严格 ===10：数量是 JSON 模式下最易遵守的硬性要求；一旦容错放行残缺的 8~9 句，
    // $setOnInsert 入库后永久复用就无法修复了，宁可 503 走冷却重试。
    if (sentences.length !== SENTENCE_COUNT || sentences.some((s) => !s.en || !s.zh)) {
      throw new ServiceUnavailableException('口语生成不完整，请稍后重试');
    }

    // $setOnInsert + date 唯一索引：同一日期只写一次。
    // 将来若开多实例并发插入撞 unique(11000)，此处 upsert 天然只留一份，其余请求回读即可。
    return this.sentenceModel
      .findOneAndUpdate(
        { date },
        {
          $setOnInsert: {
            date,
            sceneKey: scene.key,
            sceneName: scene.name,
            sceneEmoji: scene.emoji,
            sentences,
          },
        },
        { upsert: true, new: true },
      )
      .lean<DailySentenceDoc>()
      .exec() as unknown as Promise<DailySentenceDoc>;
  }

  /** en/zh 必填；situation 允许空（前端 wx:if 隐藏，比整组 503 温和） */
  private sanitizeSentences(list?: DailySentenceItem[]): DailySentenceItem[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s && typeof s.en === 'string' && s.en.trim())
      .map((s) => ({
        en: String(s.en).trim(),
        zh: String(s.zh || '').trim(),
        situation: String(s.situation || '').trim(),
      }));
  }
}
