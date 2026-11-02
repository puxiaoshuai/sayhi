import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface DailyParagraph {
  en: string;
  zh: string;
}

/**
 * 与 SceneVocabItem / Favorite.vocabulary 内嵌结构完全同形，
 * 收藏进生词本时零转换直接透传（见技术方案 4.2 映射约定）。
 */
export interface DailyWord {
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
}

/**
 * 每日一文：LLM 每天定时生成一篇英语短文，全局一份（无 user 维度，同 Scene 先例），
 * 生成一次入库永久复用（见技术方案 6.4 缓存复用模式）。
 */
@Schema({ timestamps: true })
export class DailyArticle extends Document {
  @Prop({ required: true, unique: true })
  date: string; // 'YYYY-MM-DD'，北京时区口径，业务唯一键——一天只有一篇

  @Prop({ required: true })
  title: string; // 英文标题

  @Prop({ required: true })
  titleZh: string; // 中文标题

  @Prop({ required: true })
  topic: string; // 题材（轮换表中的中文词）。留档让重试得到同题材，前端展示 tag

  @Prop({ type: [{ en: String, zh: String }], default: [] })
  paragraphs: DailyParagraph[]; // 正文段落（4~6 段），每段英文 + 整段中文翻译

  @Prop({
    type: [{ word: String, phonetic: String, pos: String, meaning: String }],
    default: [],
  })
  words: DailyWord[]; // 重点单词（6~8 个），必须出自正文
}

export const DailyArticleSchema = SchemaFactory.createForClass(DailyArticle);
