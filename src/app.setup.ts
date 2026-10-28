import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { appError } from './common/errors';

/** Xato xabarlari: `items.0.qty: qty must be a number` ko'rinishida. */
function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => `${path}: ${message}`);
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

/** `main.ts` va testlar uchun umumiy sozlash. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors(origins.length ? { origin: origins } : undefined);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    // Noma'lum maydonlar jimgina tashlanadi (frontend `source`, `cashierId` yuborsa ham — ular tokendan olinadi)
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) => appError('invalid_input', flatten(errors).join('; ')),
    }),
  );
}
