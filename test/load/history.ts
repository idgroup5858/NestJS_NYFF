/**
 * Yuk testi bazasi: demo ma'lumotnomalari (menyu, ombor, xodimlar) + bir yillik buyurtmalar tarixi — kuniga ~1500 ta
 * (2 filial), ombor harakatlari va smenalar bilan. Tarix to'g'ridan-to'g'ri SQL bilan (`unnest` bo'laklari) yoziladi —
 * servis orqali yillik tarix soatlab ketardi; shakli servis yozadigan bilan bir xil.
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { hashPin } from '../../src/auth/pin';
import { newId } from '../../src/common/ids';
import { seedDemo } from '../fixtures/demo';
import { ZONE_POINTS } from '../fixtures/demo-data';

export interface HistoryOptions {
  days: number;
  perDay: number;
  log: (line: string) => void;
}

/** Yuk testi uchun qo'shimcha kuryerlar (demo'da 2 ta) — kuniga 1500 buyurtmada 2 kishi ulgurmaydi. */
export const EXTRA_COURIERS = Array.from({ length: 6 }, (_, i) => ({
  id: `usr_courier_load_${i + 3}`,
  name: `Kuryer ${i + 3}`,
  surname: 'Yuk',
  email: `kuryer${i + 3}@gmail.com`,
  password: '12345678',
}));

interface ProductRow {
  id: string;
  name: Record<string, string>;
  price: number;
  recipe: { ingredientId: string; qty: number }[];
}

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const minutes = (date: Date, value: number) => new Date(date.getTime() + value * 60_000);

/** Soat bo'yicha og'irlik (10:00–23:00): tushlik va kechki cho'qqi. */
const HOUR_WEIGHTS: [hour: number, weight: number][] = [
  [10, 3], [11, 6], [12, 12], [13, 12], [14, 7], [15, 5], [16, 5], [17, 7], [18, 11], [19, 12], [20, 10], [21, 6], [22, 4],
];
const HOUR_TOTAL = HOUR_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

function randomTime(day: Date): Date {
  let roll = Math.random() * HOUR_TOTAL;
  for (const [hour, weight] of HOUR_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, Math.random() * 3600);
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 22, 30);
}

/** Bo'laklab yozuvchi: ustunlar massivlari to'lganda bitta `INSERT … SELECT * FROM unnest(…)`. */
class Batch {
  private columns: unknown[][];
  rows = 0;
  total = 0;

  constructor(
    private readonly ds: DataSource,
    private readonly table: string,
    private readonly names: string[],
    private readonly types: string[],
    private readonly size: number,
  ) {
    this.columns = names.map(() => []);
  }

  async add(values: unknown[]): Promise<void> {
    values.forEach((value, index) => this.columns[index].push(value));
    this.rows++;
    if (this.rows >= this.size) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.rows === 0) return;
    const columns = this.names.map((name) => `"${name}"`).join(', ');
    const arrays = this.types.map((type, index) => `$${index + 1}::${type}[]`).join(', ');
    await this.ds.query(`INSERT INTO ${this.table} (${columns}) SELECT * FROM unnest(${arrays})`, this.columns);
    this.total += this.rows;
    this.columns = this.names.map(() => []);
    this.rows = 0;
  }
}

/** Baza tayyor bo'lsa (tarix bor) — o'tkazib yuboradi. Natija: buyurtmalar soni. */
export async function prepareDatabase({ days, perDay, log }: HistoryOptions): Promise<number> {
  // ulanish, baza yaratish va migratsiyalar — ilovaning o'zidagidek (`DatabaseModule`)
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const ds = app.get(DataSource);
    const [{ count }] = await ds.query(`SELECT COUNT(*)::int AS count FROM orders`);
    if (count > perDay * days * 0.5) {
      log(`Tarix bor (${count} ta buyurtma) — qayta yozilmaydi`);
      return count;
    }

    log("Demo ma'lumotnomalari (menyu, ombor, xodimlar)…");
    await seedDemo(app, { activity: false });
    const createdAt = new Date();
    for (const courier of EXTRA_COURIERS) {
      await ds.query(
        `INSERT INTO users (id, name, surname, role, "branchId", email, "pinHash", "failedPinAttempts", "pinLockedUntil", active, "onDuty", "createdAt")
         VALUES ($1, $2, $3, 'courier', NULL, $4, $5, 0, NULL, true, false, $6)`,
        [courier.id, courier.name, courier.surname, courier.email, await hashPin(courier.password), createdAt],
      );
    }

    const products: ProductRow[] = (
      await ds.query(`SELECT id, name, price::int AS price, recipe FROM products WHERE active ORDER BY id`)
    ).map((row: ProductRow) => ({ ...row, price: Number(row.price) }));
    const branches: { id: string; warehouseId: string; cashiers: string[] }[] = [];
    for (const { id } of await ds.query(`SELECT id FROM branches WHERE active ORDER BY "createdAt", name`)) {
      const [{ id: warehouseId }] = await ds.query(`SELECT id FROM warehouses WHERE kind = 'branch' AND "branchId" = $1`, [id]);
      const cashiers = (await ds.query(`SELECT id FROM users WHERE role = 'cashier' AND "branchId" = $1 ORDER BY id`, [id])).map(
        (row: { id: string }) => row.id,
      );
      branches.push({ id, warehouseId, cashiers });
    }
    const couriers: string[] = (await ds.query(`SELECT id FROM users WHERE role = 'courier' ORDER BY id`)).map(
      (row: { id: string }) => row.id,
    );

    const orders = new Batch(
      ds,
      'orders',
      ['id', 'branchId', 'number', 'type', 'source', 'items', 'total', 'payment', 'online', 'status', 'cashierId', 'shiftId',
        'createdAt', 'preparingAt', 'readyAt', 'cancelledAt', 'cancelledBy', 'routedAt', 'trackingTokenHash', 'deliveryFee',
        'courierId', 'takenAt', 'departedAt', 'deliveredAt', 'courierSeq', 'courierLegKm'],
      ['varchar', 'varchar', 'int', 'varchar', 'varchar', 'jsonb', 'bigint', 'varchar', 'jsonb', 'varchar', 'varchar', 'varchar',
        'timestamptz', 'timestamptz', 'timestamptz', 'timestamptz', 'varchar', 'timestamptz', 'varchar', 'bigint',
        'varchar', 'timestamptz', 'timestamptz', 'timestamptz', 'int', 'float8'],
      5000,
    );
    const movements = new Batch(
      ds,
      'stock_movements',
      ['id', 'warehouseId', 'ingredientId', 'qty', 'kind', 'refId', 'createdAt'],
      ['varchar', 'varchar', 'varchar', 'int', 'varchar', 'varchar', 'timestamptz'],
      20000,
    );
    const shifts = new Batch(
      ds,
      'shifts',
      ['id', 'branchId', 'cashierId', 'openedAt', 'closedAt'],
      ['varchar', 'varchar', 'varchar', 'timestamptz', 'timestamptz'],
      2000,
    );

    const started = Date.now();
    const today = new Date();
    for (let ago = days; ago >= 1; ago--) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago);
      const dayTotal = Math.round(perDay * random(0.9, 1.1));
      for (const [index, branch] of branches.entries()) {
        // ikki smena: ertalabki va kechki kassir
        const split = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 16);
        const dayShifts = branch.cashiers.slice(0, 2).map((cashierId, i) => ({
          id: newId('shf'),
          cashierId,
          openedAt: i === 0 ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 30) : split,
          closedAt: i === 0 ? split : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 50),
        }));
        for (const s of dayShifts) await shifts.add([s.id, branch.id, s.cashierId, s.openedAt, s.closedAt]);
        const shiftAt = (at: Date) => (at < split ? dayShifts[0] : dayShifts[dayShifts.length - 1]);

        const count = Math.round(dayTotal * (index === 0 ? 0.55 : 0.45));
        const times = Array.from({ length: count }, () => randomTime(day)).sort((a, b) => a.getTime() - b.getTime());
        for (const [n, createdAt] of times.entries()) {
          const roll = Math.random();
          const source = roll < 0.65 ? 'cashier' : roll < 0.8 ? 'kiosk' : 'mobile';
          const type =
            source === 'mobile' ? (Math.random() < 0.75 ? 'delivery' : 'takeaway') : Math.random() < 0.5 ? 'dine_in' : 'takeaway';
          const lines = new Map<string, number>();
          for (let i = 0, k = 1 + Math.floor(Math.random() * 4); i < k; i++) {
            const product = pick(products);
            lines.set(product.id, (lines.get(product.id) ?? 0) + (Math.random() < 0.8 ? 1 : 2));
          }
          const items = [...lines].map(([productId, qty]) => {
            const product = products.find((p) => p.id === productId)!;
            return { productId, name: product.name, price: product.price, qty };
          });
          const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);

          const onlinePayment = Math.random() < 0.6 ? 'cash' : 'click';
          const online =
            source === 'mobile'
              ? {
                  platform: Math.random() < 0.8 ? 'android' : 'ios',
                  name: 'Mijoz',
                  phone: `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
                  address: type === 'delivery' ? "Toshkent, 5-uy, 12-xonadon" : '',
                  payment: onlinePayment,
                  location: type === 'delivery' ? ZONE_POINTS[branch.id] ?? null : null,
                }
              : null;
          const kioskPaid = source === 'kiosk' && Math.random() < 0.5;
          const payment =
            source === 'mobile'
              ? onlinePayment
              : source === 'kiosk'
                ? kioskPaid
                  ? pick(['card', 'click'])
                  : 'cash'
                : pick(['cash', 'cash', 'cash', 'card', 'card', 'click']);
          // kassir: o'zi yaratgan, kiosk "kassada to'layman" / mobil — qabul qilgan; kartali kiosk — smenasiz
          const preparingAt = source === 'mobile' ? minutes(createdAt, random(0.5, 4)) : source === 'kiosk' && !kioskPaid ? minutes(createdAt, random(0.5, 3)) : createdAt;
          const shift = kioskPaid ? null : shiftAt(preparingAt);
          const cancelled = Math.random() < 0.035;
          const readyAt = cancelled ? null : minutes(preparingAt, random(4, 15));
          const cancelledAt = cancelled ? minutes(preparingAt, random(2, 10)) : null;
          const delivery = source === 'mobile' && type === 'delivery' && !cancelled;
          const courierId = delivery ? pick(couriers) : null;
          const id = newId('ord');

          await orders.add([
            id, branch.id, n + 1, type, source, JSON.stringify(items), total, payment, online && JSON.stringify(online),
            cancelled ? 'cancelled' : 'ready', shift?.cashierId ?? null, shift?.id ?? null,
            createdAt, preparingAt, readyAt, cancelledAt, cancelled ? (shift?.cashierId ?? null) : null, createdAt,
            source === 'mobile' ? newId('trk').padEnd(64, '0').slice(0, 64) : null,
            delivery ? 10_000 : null,
            courierId, delivery ? minutes(readyAt!, -1) : null, delivery ? minutes(readyAt!, 2) : null,
            delivery ? minutes(readyAt!, random(12, 35)) : null, delivery ? 1 : null, delivery ? random(0.5, 5) : null,
          ]);

          // ombor: to'langani — retsept bo'yicha chiqim; bekor qilingani — qaytdi
          const deltas = new Map<string, number>();
          for (const item of items) {
            for (const line of products.find((p) => p.id === item.productId)!.recipe) {
              deltas.set(line.ingredientId, (deltas.get(line.ingredientId) ?? 0) - line.qty * item.qty);
            }
          }
          for (const [ingredientId, qty] of deltas) {
            if (qty === 0) continue;
            await movements.add([newId('mov'), branch.warehouseId, ingredientId, qty, 'sale', id, preparingAt]);
            if (cancelled) await movements.add([newId('mov'), branch.warehouseId, ingredientId, -qty, 'sale_cancel', id, cancelledAt]);
          }
        }
      }
      if (ago % 30 === 0) {
        log(`  ${days - ago + 1}/${days} kun: ${orders.total + orders.rows} buyurtma, ${movements.total + movements.rows} harakat (${Math.round((Date.now() - started) / 1000)} s)`);
      }
    }
    await orders.flush();
    await movements.flush();
    await shifts.flush();
    log('ANALYZE…');
    await ds.query('ANALYZE');
    log(`Tarix yozildi: ${orders.total} buyurtma, ${movements.total} harakat, ${shifts.total} smena (${Math.round((Date.now() - started) / 1000)} s)`);
    return orders.total;
  } finally {
    await app.close();
  }
}
