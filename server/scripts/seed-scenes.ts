/**
 * 场景内容预热脚本（见技术方案 6.4）：
 * 部署后执行一次 `npm run seed:scenes`，为所有叶子场景生成内容并入库，
 * 让第一批用户打开即命中缓存（毫秒级响应）。
 * 幂等：已生成内容的场景会被跳过（getScene 直接返回库中结果）。
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ScenesService } from '../src/scenes/scenes.service';
import { leafSeeds } from '../src/scenes/scene.seeds';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const scenesService = app.get(ScenesService);

  console.log('🌱 开始预热场景内容...\n');
  for (const seed of leafSeeds()) {
    try {
      const scene = await scenesService.getScene(seed.sceneKey);
      console.log(
        `✅ ${seed.emoji} ${seed.name}（${seed.sceneKey}）就绪：词汇 ${scene.vocabulary.length} 个，语句 ${scene.expressions.length} 句`,
      );
    } catch (e) {
      console.error(`❌ ${seed.emoji} ${seed.name}（${seed.sceneKey}）生成失败：${e.message}`);
      process.exitCode = 1;
    }
  }

  await app.close();
  console.log('\n🌿 预热结束。');
}

main().catch((e) => {
  console.error('预热脚本执行失败：', e);
  process.exit(1);
});
