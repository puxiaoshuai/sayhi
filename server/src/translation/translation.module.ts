import { Module } from '@nestjs/common';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';
import { LlmService } from '../common/llm.service';

@Module({
  controllers: [TranslationController],
  providers: [TranslationService, LlmService],
})
export class TranslationModule {}
