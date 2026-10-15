import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Favorite } from '../schemas/favorite.schema';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { ListFavoritesDto } from './dto/list-favorites.dto';

/** 默认每页条数，与小程序端 PAGE_SIZE 保持一致 */
const DEFAULT_LIMIT = 20;

/**
 * 转义正则元字符。
 * 不转义的话用户输入 "(" 会让 new RegExp 直接抛错，"查.*" 又会命中整表。
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 游标编解码用到的字段，lean() 出来的 doc 满足这个形状 */
type CursorDoc = { createdAt: Date | string; _id: Types.ObjectId };

/**
 * 游标 = `<createdAt 毫秒>_<_id>`。
 * 只带 createdAt 不够：同一毫秒插入多条时，$lt 会漏掉 / $lte 会重复，
 * 所以必须带上 _id 做兜底排序键。
 * ObjectId 是 24 位十六进制、不含下划线，故按首个下划线切分是安全的。
 */
function encodeCursor(doc: CursorDoc): string {
  return `${new Date(doc.createdAt).getTime()}_${String(doc._id)}`;
}

/** 解析非法游标一律返回 null（当作第一页），不让畸形入参把接口打成 500 */
function decodeCursor(cursor: string): CursorDoc | null {
  const sep = cursor.indexOf('_');
  if (sep <= 0) return null;

  const ms = Number(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (!Number.isFinite(ms) || !Types.ObjectId.isValid(id)) return null;

  return { createdAt: new Date(ms), _id: new Types.ObjectId(id) };
}

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(Favorite.name) private readonly favoriteModel: Model<Favorite>,
  ) {}

  /**
   * 游标分页拉取收藏（新→旧）+ 关键词搜索。
   * 多取一条来判断还有没有下一页，省掉一次 countDocuments。
   */
  async listByUser(userId: string, query: ListFavoritesDto = {}) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };

    const keyword = (query.keyword || '').trim();
    if (keyword) {
      const re = new RegExp(escapeRegex(keyword), 'i');
      filter.$or = [{ sourceText: re }, { translation: re }];
    }

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      // 用 $and 而不是直接赋 $or：上面的关键词过滤已经占了 $or，直接赋值会互相覆盖
      filter.$and = [
        {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
          ],
        },
      ];
    }

    const docs = await this.favoriteModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;

    return {
      items,
      hasMore,
      // 游标取本页最后一条（最旧那条），下一页从它之后接着取。
      // createdAt 由 @Schema({ timestamps: true }) 在运行时注入，类上没声明，
      // 所以这里 TS 看不见它，需要绕过类型检查。
      nextCursor: hasMore
        ? encodeCursor(items[items.length - 1] as unknown as CursorDoc)
        : null,
    };
  }

  /** 新增收藏（sourceType 区分来源：翻译 / 场景词汇 / 场景语句，见技术方案 4.2） */
  async create(userId: string, dto: CreateFavoriteDto) {
    const created = await this.favoriteModel.create({
      userId: new Types.ObjectId(userId),
      sourceText: dto.sourceText,
      translation: dto.translation,
      vocabulary: dto.vocabulary || [],
      patterns: dto.patterns || [],
      sourceType: dto.sourceType || 'translation',
      sceneKey: dto.sceneKey || null,
      sceneName: dto.sceneName || null,
    });
    return created.toObject();
  }

  /** 删除收藏（校验归属，防止越权删除他人数据） */
  async remove(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('收藏记录不存在');
    }
    const result = await this.favoriteModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('收藏记录不存在');
    }
    return { deleted: true };
  }
}
