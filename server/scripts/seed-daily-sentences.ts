/**
 * 每日口语预生成脚本：
 * `npm run seed:daily-sentences` 生成当天的每日口语（幂等：当天已有则直接返回）。
 * 使用场景：cron 错过 06:00（如 pm2 reload / 停机跨点）后不想让首个用户等数秒时，
 * 部署完手动跑一次即可。日常不需要跑——读接口本身就有按需兜底。
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DailySentencesService, beijingToday } from '../src/daily-sentences/daily-sentences.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dailySentencesService = app.get(DailySentencesService);

  const date = beijingToday();
  console.log(`🌱 开始生成 ${date} 的每日口语...\n`);
  try {
    const daily = await dailySentencesService.getByDate(date);
    console.log(
      `✅ 就绪：${daily.sceneEmoji} ${daily.sceneName}（${daily.sentences.length} 句）`,
    );
  } catch (e) {
    console.error(`❌ 生成失败：${e.message}`);
    process.exitCode = 1;
  }

  await app.close();
}

main().catch((e) => {
  console.error('预生成脚本执行失败：', e);
  process.exit(1);
});
