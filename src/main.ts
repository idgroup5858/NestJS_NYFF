import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = Number(process.env.PORT || 3000);
  // Kassa, TV, kiosk va telefonlar lokal tarmoqdan ulanishi uchun barcha tarmoq kartalarida
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`NYFF backend: http://localhost:${port}/api (Socket.IO — shu portda)`);
}
void bootstrap();
