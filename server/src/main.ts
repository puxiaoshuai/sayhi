import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 语音识别走 base64 JSON 上传，Nest 默认的 100KB body 上限远远不够。
  // 必须在 listen() 之前调用：默认 parser 是在 listen() 触发的 init() 里注册的，
  // 这里先挂上同名 parser，init() 检测到已存在就会跳过默认那个。
  app.useBodyParser('json', { limit: '12mb' });
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`🚀 Server running at http://localhost:${port}/api`);
}
bootstrap();
