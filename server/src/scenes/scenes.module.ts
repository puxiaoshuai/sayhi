import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';
import { Scene, SceneSchema } from '../schemas/scene.schema';
import { LlmService } from '../common/llm.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Scene.name, schema: SceneSchema }]),
  ],
  controllers: [ScenesController],
  providers: [ScenesService, LlmService],
})
export class ScenesModule {}
