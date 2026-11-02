import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyArticleController } from './daily-article.controller';
import { DailyArticleService } from './daily-article.service';
import { DailyArticle, DailyArticleSchema } from '../schemas/daily-article.schema';
import { LlmService } from '../common/llm.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyArticle.name, schema: DailyArticleSchema },
    ]),
  ],
  controllers: [DailyArticleController],
  providers: [DailyArticleService, LlmService],
  exports: [DailyArticleService], // 供 scripts/seed-daily.ts 预生成脚本取用
})
export class DailyArticleModule {}
