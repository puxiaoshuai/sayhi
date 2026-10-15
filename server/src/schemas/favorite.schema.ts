import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FavoriteSource =
  | 'translation'
  | 'scene_word'
  | 'scene_expression';

@Schema({ timestamps: true })
export class Favorite extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId; // 关联的用户ID

  @Prop({ required: true })
  sourceText: string; // 用户输入的中文句子（场景来源时为中文释义/中文句）

  @Prop({ required: true })
  translation: string; // 地道的英文翻译（场景词汇时为英文单词）

  @Prop({
    type: [
      {
        word: String,
        phonetic: String,
        pos: String,
        meaning: String,
      },
    ],
    default: [],
  })
  vocabulary: Array<{
    word: string;
    phonetic: string;
    pos: string;
    meaning: string;
  }>; // 重点单词/词组列表（场景词汇收藏时仅存该词条）

  @Prop({
    type: [
      {
        pattern: String,
        explanation: String,
        example: String,
      },
    ],
    default: [],
  })
  patterns: Array<{
    pattern: string;
    explanation: string;
    example: string;
  }>; // 核心句型列表

  @Prop({
    required: true,
    enum: ['translation', 'scene_word', 'scene_expression'],
    default: 'translation',
  })
  sourceType: FavoriteSource; // 收藏来源：翻译查询 / 场景词汇 / 场景语句

  @Prop({ default: null })
  sceneKey: string; // 来源场景标识（如 'home-kitchen'），翻译查询时为 null

  @Prop({ default: null })
  sceneName: string; // 来源场景名快照（如 '厨房'）。自定义场景的 key 是无意义哈希，只能靠它展示
}

export const FavoriteSchema = SchemaFactory.createForClass(Favorite);

/**
 * 列表查询索引：find({ userId }).sort({ createdAt: -1, _id: -1 })。
 * 没有它的话走全表扫描 + 内存排序；有了它 filter 和 sort 全部由索引顺序覆盖。
 * _id 进索引是为了对齐游标分页的复合排序键（见 favorites.service.ts）。
 */
FavoriteSchema.index({ userId: 1, createdAt: -1, _id: -1 });
