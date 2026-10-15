import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Scene } from '../schemas/scene.schema';
import { ScenesService } from './scenes.service';
import { CreateSceneDto } from './dto/create-scene.dto';

@Controller('scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  /** 场景列表：内置场景分组（在家 + 客厅/厨房/卧室/卫生间）+ 用户自定义场景 */
  @Get()
  getList() {
    return this.scenesService.getSceneList();
  }

  /** 场景详情：库中命中直接返回，未命中触发一次生成入库（见技术方案 6.4） */
  @Get(':sceneKey')
  async getScene(@Param('sceneKey') sceneKey: string) {
    return this.toDetail(await this.scenesService.getScene(sceneKey));
  }

  /**
   * 用户输入场景名 → 生成一个新场景（见技术方案 6.4）。
   * 同名场景已存在时直接返回，不重复生成。
   */
  @Post()
  async createScene(@Body() dto: CreateSceneDto) {
    return this.toDetail(await this.scenesService.createCustomScene(dto.name));
  }

  /** 删除自定义场景；内置场景由代码内的种子配置承载，不可删除 */
  @Delete(':sceneKey')
  deleteScene(@Param('sceneKey') sceneKey: string) {
    return this.scenesService.deleteCustomScene(sceneKey);
  }

  /** 详情响应只暴露前端需要的字段（parentSceneId 等内部字段不外泄） */
  private toDetail(scene: Scene) {
    return {
      sceneKey: scene.sceneKey,
      name: scene.name,
      emoji: scene.emoji,
      vocabulary: scene.vocabulary,
      expressions: scene.expressions,
    };
  }
}
