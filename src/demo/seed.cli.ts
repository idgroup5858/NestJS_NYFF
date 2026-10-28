/** `npm run seed` — bazani tozalab demo ma'lumot yozadi (frontend `createSeedDb` bilan bir xil manzara). */
import './cli-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DemoService } from './demo.service';

async function main() {
  // modul yuklanishi loglari kerak emas — faqat xato / ogohlantirish va yakuniy hisobot
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const demo = app.get(DemoService);
    const started = Date.now();
    await demo.reset({ activity: true });
    const counts = await demo.counts();
    console.log(`Demo ma'lumot yozildi (${process.env.DB_NAME || 'nyff'}, ${Date.now() - started} ms):`);
    for (const [table, count] of Object.entries(counts)) console.log(`  ${table.padEnd(16)} ${count}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
