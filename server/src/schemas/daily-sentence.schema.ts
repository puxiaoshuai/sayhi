import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * 与 SceneExprItem（scene.schema.ts）完全同形，
 * 收藏进生词本时零转换直接透传（见技术方案 4.2 映射约定）。
 */
export interface DailySentenceItem {
  en: string;
  zh: string;
  situation: string;
}

/**
 * 每日口语：LLM 每天围绕一个生活场景生成 10 句由浅入深的常用口语，
 * 全局一份（无 user 维度，同 Scene 先例），生成一次入库永久复用（见技术方案 6.4 缓存复用模式）。
 */
@Schema({ collection: 'daily_sentences', timestamps: true })
export class DailySentenceDoc extends Document {
  @Prop({ required: true, unique: true })
  date: string; // 'YYYY-MM-DD'，北京时区口径，业务唯一键——一天只有一组

  @Prop({ required: true })
  sceneKey: string; // 场景轮换表 key，如 'coffee'。留档保证重试同场景

  @Prop({ required: true })
  sceneName: string; // 场景中文名，如 '咖啡店点单'。前端展示头卡

  @Prop({ required: true })
  sceneEmoji: string; // 场景 emoji，如 '☕'

  @Prop({ type: [{ en: String, zh: String, situation: String }], default: [] })
  sentences: DailySentenceItem[]; // 恰好 10 句，由浅入深（寒暄→核心→确认付款→道别）
}

export const DailySentenceSchema = SchemaFactory.createForClass(DailySentenceDoc);
