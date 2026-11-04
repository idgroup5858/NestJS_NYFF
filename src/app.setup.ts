import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage } from 'node:http';
import { appError } from './common/errors';

/**
 * Offline kassa paketi (`POST /api/sync/orders`: 200 tagacha buyurtma, taom nomlari 3 tilda) uchun so'rov tanasi
 * chegarasi. Express standarti — 100 KB: 2–3 soatlik uzilishdan keyin (~150 buyurtma) paket undan oshib, markaz har
 * urinishga 413 qaytarar, navbat qotib qolardi. Qolgan yo'llarda (kiosk, mobil — ochiq) standart 100 KB qoladi.
 */
export const SYNC_BODY_LIMIT = '5mb';

/** JSON so'rov `/api/sync/…` ga — katta chegarali parser uchun (body-parser `type` funksiyasi). */
export function isSyncJson(req: IncomingMessage): boolean {
  return (req.url ?? '').startsWith('/api/sync/') && /^application\/json\b/i.test(req.headers['content-type'] ?? '');
}

/** Xato xabarlari: `items.0.qty: qty must be a number` ko'rinishida. */
function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => `${path}: ${message}`);
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

/** So'rov tanasini tekshirish. */
export function validationPipe(): ValidationPipe {
  // Noma'lum maydonlar jimgina tashlanadi (frontend `source`, `cashierId` yuborsa ham — ular tokendan olinadi)
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    exceptionFactory: (errors) => appError('invalid_input', flatten(errors).join('; ')),
  });
}

/**
 * Proksi (Apache / nginx — shu serverda) ortida haqiqiy mijoz IP'si — `X-Forwarded-For` dan. Busiz hamma so'rov
 * `127.0.0.1` dan kelgandek ko'rinadi va IP chegaralari (PIN bilan kirish, kiosk, mobil buyurtma — `AttemptsGuard`)
 * hamma foydalanuvchiga birga qo'llanib qoladi. `TRUST_PROXY`: bo'sh — `loopback` (faqat shu kompyuterdan kelgan
 * so'rovdagi sarlavhaga ishoniladi: 3000-portga to'g'ridan-to'g'ri ulangan mijoz IP'sini soxtalashtira olmaydi); `off` —
 * o'chiq; son — nechta proksi; boshqa — Express `trust proxy` (IP / tarmoqlar ro'yxati).
 */
export function trustProxySetting(value = process.env.TRUST_PROXY): boolean | number | string {
  const raw = (value ?? '').trim();
  if (!raw) return 'loopback';
  if (/^(off|false|0)$/i.test(raw)) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** `main.ts` va testlar uchun umumiy sozlash. */
export function configureApp(app: INestApplication): void {
  (app.getHttpAdapter().getInstance() as { set(setting: string, value: unknown): void }).set('trust proxy', trustProxySetting());
  app.setGlobalPrefix('api');
  // JSON parserlar: avval `/api/sync` (katta chegara) — u o'qigan so'rovni keyingisi qayta o'qimaydi; keyin qolgan hamma
  // yo'l (standart 100 KB). Ikkalasi ham Nest'ning o'z JSON parseridan oldin turadi — u qayta qo'shilmaydi
  const server = app as NestExpressApplication;
  server.useBodyParser('json', { limit: SYNC_BODY_LIMIT, type: isSyncJson });
  server.useBodyParser('json');
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors(origins.length ? { origin: origins } : undefined);
  app.enableShutdownHooks();
  app.useGlobalPipes(validationPipe());
}
