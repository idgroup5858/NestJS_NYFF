import type { INestApplicationContext } from '@nestjs/common';
import { DataSource, EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { hashPin } from '../../src/auth/pin';
import { Branch } from '../../src/branches/branch.entity';
import { Warehouse } from '../../src/branches/warehouse.entity';
import { Counter } from '../../src/database/counters';
import { Setting } from '../../src/database/setting.entity';
import { ExpensesService } from '../../src/expenses/expenses.service';
import { Category } from '../../src/menu/category.entity';
import { Product } from '../../src/menu/product.entity';
import { Order } from '../../src/orders/order.entity';
import { OrdersService } from '../../src/orders/orders.service';
import { Shift } from '../../src/shifts/shift.entity';
import { ShiftsService } from '../../src/shifts/shifts.service';
import { User } from '../../src/users/user.entity';
import { Ingredient } from '../../src/warehouse/ingredient.entity';
import { StockItem } from '../../src/warehouse/stock-item.entity';
import { WarehouseService } from '../../src/warehouse/warehouse.service';
import { buildBase } from './demo-data';
import {
  createRandom,
  DEMO_SEED,
  seedExpenses,
  seedHistory,
  seedStockDocuments,
  seedToday,
} from './demo-history';

/** Ko'p qatorli INSERT bo'laklari (Postgres parametrlar chegarasiga yetmasin). */
const CHUNK = 500;

async function insertChunks<T extends ObjectLiteral>(em: EntityManager, target: EntityTarget<T>, rows: T[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await em.insert(target, rows.slice(i, i + CHUNK) as QueryDeepPartialEntity<T>[]);
  }
}

export interface DemoOptions {
  /**
   * `false` — faqat ma'lumotnomalar (filiallar, menyu, ombor, xodimlar);
   * `true` — + 30 kunlik tarix, ombor hujjatlari, bugungi buyurtmalar va chiqimlar.
   */
  activity: boolean;
}

/**
 * Testlar uchun sinov to'plami (2026-11-02 gacha ilovadagi "demo ma'lumot" — ilovadan olib tashlandi, faqat testlarda):
 * barcha jadvallarni tozalaydi (`settings` dan tashqari — JWT kaliti eskirmasin) va tayyor manzarani yozadi. Tarix
 * to'g'ridan-to'g'ri, bugungi buyurtmalar va hujjatlar — haqiqiy servislar orqali. [now] — "hozir".
 */
export async function seedDemo(app: INestApplicationContext, { activity }: DemoOptions, now = new Date()): Promise<void> {
  const dataSource = app.get(DataSource);
  const base = buildBase(now);
  const users: User[] = await Promise.all(
    base.users.map(async ({ pin, ...user }) => ({
      ...user,
      pinHash: await hashPin(pin),
      failedPinAttempts: 0,
      pinLockedUntil: null,
    })),
  );
  // bitta generator — tarix va chiqimlar ketma-ket undan oladi
  const rand = createRandom(DEMO_SEED);

  await dataSource.transaction(async (em) => {
    const tables = dataSource.entityMetadatas
      .filter((meta) => meta.target !== Setting)
      .map((meta) => `"${meta.tableName}"`)
      .join(', ');
    await em.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);

    // bitta INSERT — filiallar bir-birining zaxirasi (FK statement oxirida tekshiriladi)
    await em.insert(Branch, base.branches);
    await em.insert(Warehouse, base.warehouses);
    await em.insert(User, users);
    await em.insert(Category, base.categories);
    await em.insert(Product, base.products);
    await em.insert(Ingredient, base.ingredients);
    await insertChunks(em, StockItem, base.stock);

    if (activity) {
      // tarix to'g'ridan-to'g'ri yoziladi — omborga tegmaydi
      const history = seedHistory(base, now, rand);
      await insertChunks(em, Shift, history.shifts);
      await insertChunks(em, Order, history.orders);
      await insertChunks(em, Counter, history.counters);
    }
  });
  if (!activity) return;

  // qolgani haqiqiy servislar orqali (har biri o'z tranzaksiyasida)
  await seedStockDocuments(app.get(WarehouseService), now);
  await seedToday({ orders: app.get(OrdersService), shifts: app.get(ShiftsService) }, base, now);
  await seedExpenses(app.get(ExpensesService), base, now, rand);
}

/** Jadvallardagi yozuvlar soni. */
export async function tableCounts(app: INestApplicationContext): Promise<Record<string, number>> {
  const dataSource = app.get(DataSource);
  const result: Record<string, number> = {};
  for (const meta of dataSource.entityMetadatas) {
    const [row] = (await dataSource.query(`SELECT count(*)::int AS n FROM "${meta.tableName}"`)) as { n: number }[];
    result[meta.tableName] = row.n;
  }
  return result;
}
