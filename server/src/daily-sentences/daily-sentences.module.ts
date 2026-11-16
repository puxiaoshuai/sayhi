import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailySentencesController } from './daily-sentences.controller';
import { DailySentencesService } from './daily-sentences.service';
import { DailySentenceDoc, DailySentenceSchema } from '../schemas/daily-sentence.schema';
import { LlmService } from '../common/llm.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailySentenceDoc.name, schema: DailySentenceSchema },
    ]),
  ],
  controllers: [DailySentencesController],
  providers: [DailySentencesService, LlmService],
  exports: [DailySentencesService], // 供 scripts/seed-daily-sentences.ts 预生成脚本取用
})
export class DailySentencesModule {}
