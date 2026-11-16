import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { TranslationModule } from './translation/translation.module';
import { ScenesModule } from './scenes/scenes.module';
import { FavoritesModule } from './favorites/favorites.module';
import { AsrModule } from './asr/asr.module';
import { TtsModule } from './tts/tts.module';
import { DailySentencesModule } from './daily-sentences/daily-sentences.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 定时调度器（每日口语 06:00 预生成等）。forRoot 是全局注册，放应用根模块
    ScheduleModule.forRoot(),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/sayhi',
    ),
    AuthModule,
    TranslationModule,
    ScenesModule,
    FavoritesModule,
    AsrModule,
    TtsModule,
    DailySentencesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
