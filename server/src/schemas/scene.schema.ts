import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export interface SceneVocabItem {
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
}

export interface SceneExprItem {
  en: string;
  zh: string;
  situation: string;
}

/**
 * 场景内容为公共内容：由 LLM 生成一次后入库复用（见技术方案 6.4）。
 * 场景骨架（sceneKey/name/emoji/父子关系）来自代码内的种子数据 SCENE_SEEDS，
 * LLM 只生成 vocabulary 与 expressions。
 */
@Schema({ timestamps: true })
export class Scene extends Document {
  @Prop({ required: true, unique: true })
  sceneKey: string; // 场景唯一标识，如 'home'、'home-kitchen'

  @Prop({ required: true })
  name: string; // 场景名称，如 '厨房'

  @Prop({ default: '' })
  emoji: string; // 场景图标，如 '🍳'

  @Prop({ type: Types.ObjectId, ref: 'Scene', default: null })
  parentSceneId: Types.ObjectId; // 父场景，顶级场景（如"在家"）为 null

  @Prop({ default: 'seed' })
  source: string; // 'seed' 种子场景（代码内配置） | 'custom' 用户在场景页输入生成

  @Prop({ type: String, default: '' })
  aiPromptHint: string; // 生成内容时的补充提示（如"中国家庭常见物品"）

  @Prop({ type: [{ word: String, phonetic: String, pos: String, meaning: String }], default: [] })
  vocabulary: SceneVocabItem[]; // 该场景常见物品词汇（15~20 个）

  @Prop({ type: [{ en: String, zh: String, situation: String }], default: [] })
  expressions: SceneExprItem[]; // 该场景高频沟通语句（10~15 句）
}

export const SceneSchema = SchemaFactory.createForClass(Scene);
