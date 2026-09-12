import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('', { exclude: [] });
  app.enableCors({ origin: true });
  const port = Number(process.env.PORT || 3001);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[royalty-splitter] 核算服务已启动: http://127.0.0.1:${port}`);
}
bootstrap();
