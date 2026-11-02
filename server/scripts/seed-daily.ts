/**
 * 每日一文预生成脚本：
 * `npm run seed:daily` 生成当天的每日一文（幂等：当天已有则直接返回）。
 * 使用场景：cron 错过 06:00（如 pm2 reload / 停机跨点）后不想让首个用户等 10~30 秒时，
 * 部署完手动跑一次即可。日常不需要跑——读接口本身就有按需兜底。
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DailyArticleService, beijingToday } from '../src/daily-article/daily-article.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dailyArticleService = app.get(DailyArticleService);

  const date = beijingToday();
  console.log(`🌱 开始生成 ${date} 的每日一文...\n`);
  try {
    const article = await dailyArticleService.getByDate(date);
    console.log(
      `✅ 就绪：${article.title}（${article.topic}，段落 ${article.paragraphs.length} 段，重点词 ${article.words.length} 个）`,
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
