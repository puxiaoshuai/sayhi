import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { Scene, SceneVocabItem, SceneExprItem } from '../schemas/scene.schema';
import { LlmService } from '../common/llm.service';
import { extractJson } from '../common/json.util';
import { SCENE_SEEDS, SceneSeed, findSeed } from './scene.seeds';

/**
 * 场景内容生成 Prompt（种子场景与自定义场景共用）。
 * 具体语境（中国家庭 / 机场 / 咖啡店……）由调用方通过补充提示传入，
 * 所以正文不写死"家庭"，只约束结构与质量标准。
 */
const SCENE_SYSTEM_PROMPT = `你是英语场景学习内容生成器。根据给定的生活场景，生成结构化 JSON。
必须且只能返回合法 JSON，不含任何 markdown 标记或多余文本。结构：
{
  "name": "规范化的场景名（中文，4 字以内）",
  "emoji": "一个最贴合该场景的 emoji",
  "vocabulary": [
    { "word": "物品英文名", "phonetic": "美式音标如 /rɪˈfrɪdʒəreɪtər/", "pos": "词性缩写（名词统一用 n.）", "meaning": "中文释义" }
  ],
  "expressions": [
    { "en": "英文语句", "zh": "中文翻译", "situation": "简短说明这句话在什么情况下说（10字以内）" }
  ]
}
硬性要求：
1. vocabulary：15~20 个该场景高频物品名词，必须贴合提示中给出的场景背景
2. expressions：10~15 句该场景真实高频的口语对白（家庭场景即家人之间的日常对白，公共场所即与服务人员的对白），必须是地道日常口语（如 "Can you take out the trash?"），严格禁止教科书式书面语（如 "Please put the garbage outside"）
3. 每条字段都必须非空`;

/** 自定义场景 sceneKey 前缀，与种子 key（如 home-kitchen）天然隔离，不会撞车 */
const CUSTOM_KEY_PREFIX = 'custom-';

/** 判断单个字符是否为 emoji 图形字符（Unicode 属性转义，ES2018 起可用） */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** 场景名归一化：去掉首尾与中间的空白，让「坐 飞机」和「坐飞机」算同一个场景 */
function normalizeSceneName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, '');
}

/**
 * 自定义场景的 sceneKey：名字哈希的确定性结果。
 * 同一个名字永远算出同一个 key，所以重复输入会命中已有场景、不会重复调用大模型。
 */
function customSceneKey(name: string): string {
  const digest = createHash('sha1').update(normalizeSceneName(name)).digest('hex');
  return `${CUSTOM_KEY_PREFIX}${digest.slice(0, 10)}`;
}

@Injectable()
export class ScenesService {
  /** single-flight：同一场景并发请求共享同一个生成 Promise，避免重复生成（见技术方案 6.4） */
  private readonly generating = new Map<string, Promise<Scene>>();

  constructor(
    @InjectModel(Scene.name) private readonly sceneModel: Model<Scene>,
    private readonly llm: LlmService,
  ) {}

  /** 场景树直接由种子构建（骨架是确定配置，零延迟、无需查库） */
  getTree() {
    const build = (parentKey: string | null) =>
      SCENE_SEEDS.filter((s) => s.parent === parentKey).map((s) => ({
        sceneKey: s.sceneKey,
        name: s.name,
        emoji: s.emoji,
        children: build(s.sceneKey),
      }));
    return build(null);
  }

  /**
   * 场景列表：内置场景沿用种子骨架（分组树），自定义场景取库中 source=custom 的记录。
   * 前端「在家」段渲染 groups、「我的场景」段渲染 custom。
   */
  async getSceneList() {
    const custom = await this.sceneModel
      .find({ source: 'custom' })
      .sort({ createdAt: -1, _id: -1 })
      .select('sceneKey name emoji -_id')
      .lean<Array<Pick<Scene, 'sceneKey' | 'name' | 'emoji'>>>();
    return { groups: this.getTree(), custom };
  }

  /**
   * 场景详情：查库命中直接返回（毫秒级、零 API 成本）；
   * 未命中（预热漏掉时兜底）走"生成→清洗→入库"，结果永久复用。
   */
  async getScene(sceneKey: string): Promise<Scene> {
    const seed = findSeed(sceneKey);

    const cached = await this.sceneModel.findOne({ sceneKey }).lean<Scene>();
    // 有内容（种子叶子场景、自定义场景）即命中；顶级场景（如"在家"）仅作分组无内容，骨架也直接返回
    const hasContent = !!(cached?.vocabulary?.length && cached?.expressions?.length);
    if (cached && (hasContent || (seed && seed.parent === null))) {
      return cached;
    }

    // 非种子场景没有"按需生成"通道：自定义场景只能由 createCustomScene 创建（内容随创建生成入库）
    if (!seed) {
      throw new NotFoundException(`场景不存在：${sceneKey}`);
    }

    if (!this.generating.has(sceneKey)) {
      const p = this.generateAndSave(sceneKey, seed)
        .catch((e) => {
          throw e;
        })
        .finally(() => this.generating.delete(sceneKey));
      this.generating.set(sceneKey, p);
    }
    return this.generating.get(sceneKey)!;
  }

  /**
   * 用户输入场景名 → 生成并入库一个新场景（见技术方案 6.4）。
   * 同名场景已存在时直接返回，不重复调用大模型。
   */
  async createCustomScene(rawName: string): Promise<Scene> {
    const name = normalizeSceneName(rawName);
    if (!name) {
      throw new BadRequestException('场景名称不能为空');
    }
    const sceneKey = customSceneKey(name);

    const cached = await this.sceneModel.findOne({ sceneKey }).lean<Scene>();
    if (cached?.vocabulary?.length && cached?.expressions?.length) {
      return cached;
    }

    if (!this.generating.has(sceneKey)) {
      const p = this.generateCustomAndSave(sceneKey, name)
        .catch((e) => {
          throw e;
        })
        .finally(() => this.generating.delete(sceneKey));
      this.generating.set(sceneKey, p);
    }
    return this.generating.get(sceneKey)!;
  }

  /** 删除自定义场景；内置种子场景是代码内配置的骨架，不允许删 */
  async deleteCustomScene(sceneKey: string) {
    if (findSeed(sceneKey)) {
      throw new BadRequestException('内置场景不可删除');
    }
    const removed = await this.sceneModel
      .findOneAndDelete({ sceneKey, source: 'custom' })
      .lean<Scene>();
    if (!removed) {
      throw new NotFoundException(`场景不存在：${sceneKey}`);
    }
    return { deleted: true };
  }

  private async generateAndSave(sceneKey: string, seed: SceneSeed): Promise<Scene> {
    // 叶子场景才生成内容
    let vocab: SceneVocabItem[] = [];
    let exprs: SceneExprItem[] = [];
    if (seed.parent !== null) {
      const raw = await this.llm.chatJsonWithRetry(
        SCENE_SYSTEM_PROMPT,
        `场景：${seed.name}（属于"${findSeed(seed.parent)?.name ?? ''}"场景）\n补充要求：${seed.aiPromptHint || '中国家庭常见物品'}`,
      );
      const parsed = extractJson<{ vocabulary?: SceneVocabItem[]; expressions?: SceneExprItem[] }>(raw);
      vocab = this.sanitizeVocab(parsed.vocabulary);
      exprs = this.sanitizeExprs(parsed.expressions);
      if (vocab.length < 5 || exprs.length < 3) {
        throw new ServiceUnavailableException('场景内容生成不完整，请稍后重试');
      }
    }

    // 确保全树骨架入库（含父场景），sceneKey 唯一索引天然防并发重复
    await this.ensureSkeletons();
    const parent = seed.parent
      ? await this.sceneModel.findOne({ sceneKey: seed.parent }).exec()
      : null;

    return this.sceneModel
      .findOneAndUpdate(
        { sceneKey },
        {
          $set: {
            sceneKey,
            name: seed.name,
            emoji: seed.emoji,
            source: 'seed',
            parentSceneId: parent ? (parent._id as Types.ObjectId) : null,
            aiPromptHint: seed.aiPromptHint || '',
            ...(seed.parent !== null ? { vocabulary: vocab, expressions: exprs } : {}),
          },
        },
        { new: true, upsert: true },
      )
      .lean<Scene>()
      .exec() as unknown as Promise<Scene>;
  }

  /**
   * 自定义场景的生成与入库。
   * 场景名与图标交给大模型规范化（用户可能输入"我想学坐飞机"这类口语化描述），
   * 拿不到就回退到用户原始输入。
   */
  private async generateCustomAndSave(sceneKey: string, name: string): Promise<Scene> {
    const raw = await this.llm.chatJsonWithRetry(
      SCENE_SYSTEM_PROMPT,
      `用户想学的场景：「${name}」\n补充要求：词汇与语句都要贴合「${name}」中真实会遇到的情况，不要泛化成通用日常内容。`,
    );
    const parsed = extractJson<{
      name?: string;
      emoji?: string;
      vocabulary?: SceneVocabItem[];
      expressions?: SceneExprItem[];
    }>(raw);

    const vocab = this.sanitizeVocab(parsed.vocabulary);
    const exprs = this.sanitizeExprs(parsed.expressions);
    if (vocab.length < 5 || exprs.length < 3) {
      throw new ServiceUnavailableException('场景内容生成不完整，请稍后重试');
    }

    const displayName = String(parsed.name || '').trim().slice(0, 20) || name;

    return this.sceneModel
      .findOneAndUpdate(
        { sceneKey },
        {
          $set: {
            sceneKey,
            name: displayName,
            emoji: this.sanitizeEmoji(parsed.emoji),
            source: 'custom',
            parentSceneId: null,
            aiPromptHint: name,
            vocabulary: vocab,
            expressions: exprs,
          },
        },
        { new: true, upsert: true },
      )
      .lean<Scene>()
      .exec() as unknown as Promise<Scene>;
  }

  /** 把种子骨架整体 upsert 入库（幂等，重复执行无副作用） */
  private async ensureSkeletons() {
    for (const s of SCENE_SEEDS) {
      const parent = s.parent
        ? await this.sceneModel.findOne({ sceneKey: s.parent }).exec()
        : null;
      await this.sceneModel.updateOne(
        { sceneKey: s.sceneKey },
        {
          $setOnInsert: {
            sceneKey: s.sceneKey,
            name: s.name,
            emoji: s.emoji,
            source: 'seed',
            parentSceneId: parent ? (parent._id as Types.ObjectId) : null,
            aiPromptHint: s.aiPromptHint || '',
            vocabulary: [],
            expressions: [],
          },
        },
        { upsert: true },
      );
    }
  }

  private sanitizeVocab(list?: SceneVocabItem[]): SceneVocabItem[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter((v) => v && typeof v.word === 'string' && v.word.trim())
      .map((v) => ({
        word: String(v.word).trim(),
        phonetic: String(v.phonetic || '').trim(),
        pos: String(v.pos || 'n.').trim(),
        meaning: String(v.meaning || '').trim(),
      }));
  }

  private sanitizeExprs(list?: SceneExprItem[]): SceneExprItem[] {
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => e && typeof e.en === 'string' && e.en.trim())
      .map((e) => ({
        en: String(e.en).trim(),
        zh: String(e.zh || '').trim(),
        situation: String(e.situation || '').trim(),
      }));
  }

  /**
   * 只取大模型返回文本里的首个 emoji 图形字符（含变体选择符/零宽连接符组合，
   * 如 ✈️ 是 U+2708+U+FE0F），拿不到就回退默认图标——避免整个句子被塞进 emoji 字段。
   */
  private sanitizeEmoji(raw?: string): string {
    const chars = Array.from(String(raw || '').trim());
    const start = chars.findIndex((c) => PICTOGRAPHIC.test(c));
    if (start < 0) return '📌';

    // 从图形字符起把紧邻的组合符一起带上（VS16 U+FE0F / ZWJ U+200D / 肤色 U+1F3FB-1F3FF），
    // 以及 ZWJ 后面的下一个图形字符，这样 👨‍👩‍👧 这类序列不会被截断成单个人物。
    let end = start + 1;
    while (end < chars.length) {
      const code = chars[end].codePointAt(0) ?? 0;
      const isCombining =
        code === 0xfe0f || code === 0x200d || (code >= 0x1f3fb && code <= 0x1f3ff);
      const afterZwj = chars[end - 1].codePointAt(0) === 0x200d;
      if (isCombining || (afterZwj && PICTOGRAPHIC.test(chars[end]))) {
        end += 1;
        continue;
      }
      break;
    }
    return chars.slice(start, end).join('');
  }
}
