import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { hashPin } from '../auth/pin';
import { Branch } from '../branches/branch.entity';
import { Warehouse } from '../branches/warehouse.entity';
import { Counter } from '../database/counters';
import { Setting } from '../database/setting.entity';
import { ExpensesService } from '../expenses/expenses.service';
import { Category } from '../menu/category.entity';
import { Product } from '../menu/product.entity';
import { Order } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { Shift } from '../shifts/shift.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { User } from '../users/user.entity';
import { Ingredient } from '../warehouse/ingredient.entity';
import { StockItem } from '../warehouse/stock-item.entity';
import { WarehouseService } from '../warehouse/warehouse.service';
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

export interface DemoResetOptions {
  /**
   * `false` — frontend `createBaseDb`: faqat ma'lumotnomalar (menyu, ombor, xodimlar);
   * `true` — frontend `createSeedDb`: + 30 kunlik tarix, ombor hujjatlari, bugungi buyurtmalar va chiqimlar.
   */
  activity: boolean;
}

/** Demo ma'lumot: bazani tozalab, frontend demo bazasi bilan bir xil manzarani yozadi. */
@Injectable()
export class DemoService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Demo');
  /** Ikki "tiklash" bir vaqtda kelsa — navbat bilan (aks holda yozuvlar aralashib ketadi). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly shifts: ShiftsService,
    private readonly warehouse: WarehouseService,
    private readonly expenses: ExpensesService,
  ) {}

  /** `DEMO=1` va baza bo'sh (xodim yo'q) — birinchi ishga tushishda demo ma'lumot yoziladi. */
  async onApplicationBootstrap() {
    if (process.env.DEMO !== '1') return;
    if ((await this.dataSource.manager.count(User)) > 0) return;
    this.logger.log("Baza bo'sh (DEMO=1) — demo ma'lumot yozilmoqda...");
    await this.reset({ activity: true });
    const counts = await this.counts();
    this.logger.log(`Demo ma'lumot yozildi: ${counts.orders} buyurtma, ${counts.users} xodim`);
  }

  /** Barcha jadvallarni tozalaydi va demo ma'lumot yozadi. [now] — "hozir" (testlarda belgilangan vaqt). */
  reset(options: DemoResetOptions, now = new Date()): Promise<void> {
    const run = this.queue.then(() => this.run(options, now));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Jadvallardagi yozuvlar soni (seed buyrug'i hisoboti uchun). */
  async counts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const meta of this.dataSource.entityMetadatas) {
      const [row] = (await this.dataSource.query(`SELECT count(*)::int AS n FROM "${meta.tableName}"`)) as {
        n: number;
      }[];
      result[meta.tableName] = row.n;
    }
    return result;
  }

  private async run({ activity }: DemoResetOptions, now: Date): Promise<void> {
    const base = buildBase(now);
    const users: User[] = await Promise.all(
      base.users.map(async ({ pin, ...user }) => ({
        ...user,
        pinHash: await hashPin(pin),
        failedPinAttempts: 0,
        pinLockedUntil: null,
      })),
    );
    // bitta generator — tarix va chiqimlar ketma-ket undan oladi (frontend `seedActivity` dagidek)
    const rand = createRandom(DEMO_SEED);

    await this.dataSource.transaction(async (em) => {
      // `settings` (JWT kaliti) — demo ma'lumot emas: tozalansa qayta ishga tushganda barcha tokenlar eskiradi
      const tables = this.dataSource.entityMetadatas
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
        // tarix frontenddagidek to'g'ridan-to'g'ri yoziladi — omborga tegmaydi
        const history = seedHistory(base, now, rand);
        await insertChunks(em, Shift, history.shifts);
        await insertChunks(em, Order, history.orders);
        await insertChunks(em, Counter, history.counters);
      }
    });
    if (!activity) return;

    // qolgani haqiqiy servislar orqali (har biri o'z tranzaksiyasida), frontend `seedActivity` tartibida
    await seedStockDocuments(this.warehouse, now);
    await seedToday({ orders: this.orders, shifts: this.shifts }, base, now);
    await seedExpenses(this.expenses, base, now, rand);
  }
}
