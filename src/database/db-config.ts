import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function dbConnectionFromEnv(env: NodeJS.ProcessEnv = process.env): DbConnection {
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'nyff',
  };
}

export function dataSourceOptions(db: DbConnection): DataSourceOptions {
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.user,
    password: db.password,
    database: db.database,
    entities: ENTITIES,
    // Ro'yxat bilan (glob emas) — ts-node, jest va dist da bir xil ishlaydi. Yangi migratsiya `migrations/index.ts` ga.
    migrations: MIGRATIONS,
    // Sxema faqat migratsiyalar orqali o'zgaradi — ishlayotgan tizimni yangilashda ma'lumot yo'qolmaydi.
    synchronize: false,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Postgres ishga tushishini kutadi (kompyuter yoqilganda servis undan oldin ko'tarilishi mumkin)
 * va baza bo'lmasa yaratadi.
 */
export async function ensureDatabase(db: DbConnection, attempts = 30): Promise<void> {
  const logger = new Logger('Database');
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = new Client({ host: db.host, port: db.port, user: db.user, password: db.password, database: 'postgres' });
    try {
      await client.connect();
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db.database]);
      if (exists.rowCount === 0) {
        // Nom identifikator sifatida qo'yiladi — faqat xavfsiz belgilarga ruxsat.
        if (!/^[A-Za-z0-9_]+$/.test(db.database)) throw new Error(`Baza nomi noto'g'ri: ${db.database}`);
        await client.query(`CREATE DATABASE "${db.database}"`);
        logger.log(`"${db.database}" bazasi yaratildi`);
      }
      return;
    } catch (error) {
      lastError = error;
      logger.warn(`Postgres tayyor emas (${attempt}/${attempts}): ${(error as Error).message}`);
      await sleep(2000);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw lastError;
}
