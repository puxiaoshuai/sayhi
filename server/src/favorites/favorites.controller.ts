import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { ListFavoritesDto } from './dto/list-favorites.dto';
import { UserJwtGuard } from '../auth/guards/user-jwt.guard';

@Controller('favorites')
@UseGuards(UserJwtGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  /**
   * 获取当前用户收藏，游标分页 + 关键词搜索（userId 从登录态解析，不接收裸传）。
   * 查询参数：cursor / limit / keyword，见 ListFavoritesDto。
   */
  @Get()
  list(@Request() req, @Query() query: ListFavoritesDto) {
    return this.favoritesService.listByUser(req.userId, query);
  }

  /** 新增收藏：翻译结果 / 场景词汇 / 场景语句（sourceType 区分） */
  @Post()
  create(@Request() req, @Body() dto: CreateFavoriteDto) {
    return this.favoritesService.create(req.userId, dto);
  }

  /** 删除收藏（校验归属） */
  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.favoritesService.remove(req.userId, id);
  }
}
