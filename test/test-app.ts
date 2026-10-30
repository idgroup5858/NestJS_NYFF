import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { AuthUser } from '../src/auth/auth.types';

/**
 * Butun ilova (haqiqiy Postgres — `nyff_test`), HTTP so'rovlar uchun `app.getHttpServer()`. [customize] — tashqi
 * xizmatlarni soxtasiga almashtirish (`overrideProvider`).
 */
export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<INestApplication> {
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  return app;
}

/** Barcha jadvallarni tozalaydi (migratsiyalar jadvalidan tashqari). */
export async function truncateAll(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const tables = dataSource.entityMetadatas.map((meta) => `"${meta.tableName}"`).join(', ');
  await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/** Servislarni to'g'ridan-to'g'ri chaqirish uchun "kirgan xodim". */
export const actor = (id: string, role: AuthUser['role'], branchId: string | null = null): AuthUser => ({
  id,
  name: id,
  role,
  branchId,
});

/** Xato kodi bo'yicha kutish: `await expectCode('shift_not_open', () => service.x())`. */
export async function expectCode(code: string, fn: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  const response = (caught as { getResponse?: () => { code?: string } } | undefined)?.getResponse?.();
  if (response?.code !== code) {
    throw new Error(`kutilgan xato: ${code}, keldi: ${response?.code ?? String(caught)}`);
  }
}
