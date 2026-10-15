import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { TranslationModule } from './translation/translation.module';
import { ScenesModule } from './scenes/scenes.module';
import { FavoritesModule } from './favorites/favorites.module';
import { AsrModule } from './asr/asr.module';
import { TtsModule } from './tts/tts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/sayhi',
    ),
    AuthModule,
    TranslationModule,
    ScenesModule,
    FavoritesModule,
    AsrModule,
    TtsModule,
  ],
})
export class AppModule {}
