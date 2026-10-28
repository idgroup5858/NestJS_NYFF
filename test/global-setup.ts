import { config } from 'dotenv';
import { dbConnectionFromEnv, ensureDatabase } from '../src/database/db-config';

/** Test bazasi bo'lmasa yaratiladi (migratsiyalarni ilova o'zi ishga tushiradi — `migrationsRun`). */
export default async function globalSetup() {
  config({ quiet: true });
  await ensureDatabase({ ...dbConnectionFromEnv(), database: process.env.TEST_DB_NAME || 'nyff_test' }, 3);
}
