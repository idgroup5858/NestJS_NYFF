import type { INestApplication } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { seedDemo } from './fixtures/demo';
import { Product } from '../src/menu/product.entity';
import { Order } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { ShiftsService } from '../src/shifts/shifts.service';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
import type { Transfer } from '../src/warehouse/transfer.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { actor, createTestApp, expectCode } from './test-app';

/**
 * Faqat backendda bor himoyalar: PIN urinishlari chegarasi, huquqlar servis darajasida (controller'dagi `@Roles` dan
 * tashqari), bir vaqtda kelgan so'rovlar (buyurtma raqami, qoldiq) — frontendda bitta brauzer edi, bunday holat yo'q edi.
 */

const now = new Date('2026-10-23T12:00:00');
const C = 'br_chilonzor';
const Y = 'br_yunusobod';
const WC = 'wh_chilonzor';
const WY = 'wh_yunusobod';
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

const admin = actor('usr_admin', 'admin');
const supplier = actor('usr_supplier', 'supplier');
const c1 = actor('usr_cashier_c1', 'cashier', C);
const y1 = actor('usr_cashier_y1', 'cashier', Y);
const kitchenC = actor('usr_kitchen_c1', 'kitchen', C);
const kitchenY = actor('usr_kitchen_y1', 'kitchen', Y);
const items = [{ productId: 'burger-classic', qty: 1 }];

const errorCode = (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.()?.code;

describe("himoya: PIN bloki, huquqlar, bir vaqtdagi so'rovlar", () => {
  let app: INestApplication;
  let em: EntityManager;
  let auth: AuthService;
  let orders: OrdersService;
  let shifts: ShiftsService;
  let warehouse: WarehouseService;

  beforeAll(async () => {
    app = await createTestApp();
    em = app.get(DataSource).manager;
    auth = app.get(AuthService);
    orders = app.get(OrdersService);
    shifts = app.get(ShiftsService);
    warehouse = app.get(WarehouseService);
  });

  afterAll(() => app.close());

  const stockQty = async (warehouseId: string, ingredientId: string) =>
    (await em.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;
  const findOrder = (id: string) => em.findOneByOrFail(Order, { id });

  describe('PIN: 5 marta ketma-ket xato — 5 daqiqa blok', () => {
    const U = 'usr_cashier_c1'; // PIN 1234
    const attempts = async (userId: string) => {
      const [row] = (await em.query(
        `SELECT "failedPinAttempts" AS failed, "pinLockedUntil" AS until FROM users WHERE id = $1`,
        [userId],
      )) as { failed: number; until: Date | null }[];
      return row;
    };

    beforeAll(() => seedDemo(app, { activity: false }, now));

    it("1–4-xato — wrong_pin, 5-xato — too_many_attempts; blok paytida to'g'ri PIN ham ishlamaydi", async () => {
      for (let i = 1; i <= 4; i++) await expectCode('wrong_pin', () => auth.checkPin(U, '9999', now));
      expect(await attempts(U)).toEqual({ failed: 4, until: null });
      await expectCode('too_many_attempts', () => auth.checkPin(U, '9999', now));
      expect((await attempts(U)).until).toEqual(later(5));

      await expectCode('too_many_attempts', () => auth.checkPin(U, '1234', now));
      await expectCode('too_many_attempts', () =>
        auth.checkPin(U, '1234', new Date(later(5).getTime() - 1000)),
      );
      await expectCode('too_many_attempts', () => auth.login(U, '1234', C, later(4)));
      await expectCode('too_many_attempts', () => auth.unlock(c1, '1234', later(4)));
      await expectCode('too_many_attempts', () => auth.changeOwnPin(U, '1234', '5678', later(4)));
      // blok paytidagi urinishlar blokni uzaytirmaydi
      expect((await attempts(U)).until).toEqual(later(5));
      // boshqa xodimga ta'sir qilmaydi
      expect((await auth.checkPin('usr_cashier_c2', '4321', later(1))).id).toBe('usr_cashier_c2');
    });

    it("5 daqiqa o'tgach to'g'ri PIN bilan kiradi, hisoblagich nolga tushadi", async () => {
      const result = await auth.login(U, '1234', C, later(5));
      expect(result.user.id).toBe(U);
      expect(await attempts(U)).toEqual({ failed: 0, until: null });

      // hisoblagich yangidan: 4 ta xato, keyin to'g'ri — blok yo'q va yana nolga tushadi
      for (let i = 1; i <= 4; i++) await expectCode('wrong_pin', () => auth.checkPin(U, '0000', later(6)));
      expect((await auth.checkPin(U, '1234', later(6))).id).toBe(U);
      expect(await attempts(U)).toEqual({ failed: 0, until: null });
      for (let i = 1; i <= 4; i++) await expectCode('wrong_pin', () => auth.checkPin(U, '0000', later(7)));
      await expectCode('too_many_attempts', () => auth.checkPin(U, '0000', later(7)));
      expect((await attempts(U)).until).toEqual(later(12));
    });
  });

  describe('huquqlar (servis darajasida)', () => {
    beforeAll(async () => {
      await seedDemo(app, { activity: false }, now);
      await shifts.openOrResume('usr_cashier_c1', C, now);
      await shifts.openOrResume('usr_cashier_y1', Y, now);
    });

    it("bekor qilish: admin — mumkin; boshqa filial kassiri, oshpaz yordamchisi, ta'minotchi — forbidden", async () => {
      const mince0 = await stockQty(WC, 'beef-mince');
      const order = await orders.createByCashier(c1, { type: 'dine_in', items, payment: 'cash' }, now);
      expect(await stockQty(WC, 'beef-mince')).toBe(mince0 - 120);
      for (const user of [y1, kitchenC, supplier]) {
        await expectCode('forbidden', () => orders.cancel(order.id, user, now));
      }
      expect((await findOrder(order.id)).status).toBe('preparing');

      const cancelled = await orders.cancel(order.id, admin, now);
      expect(cancelled).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'usr_admin',
        cancelledAt: now,
        cancelReason: null,
      });
      expect(await stockQty(WC, 'beef-mince')).toBe(mince0);
      await expectCode('invalid_status', () => orders.cancel(order.id, admin, now));
    });

    it("kiosk buyurtmasini faqat o'z filiali kassiri tasdiqlaydi", async () => {
      const kiosk = await orders.place(
        { branchId: C, type: 'takeaway', source: 'kiosk', items, payment: null, cashierId: null },
        now,
      );
      await expectCode('forbidden', () => orders.confirm(kiosk.id, y1, { payment: 'cash' }, now));
      expect(await findOrder(kiosk.id)).toMatchObject({ status: 'pending', cashierId: null, shiftId: null });
      const confirmed = await orders.confirm(kiosk.id, c1, { payment: 'card' }, now);
      expect(confirmed).toMatchObject({ status: 'preparing', payment: 'card', cashierId: 'usr_cashier_c1' });
    });

    it('"Tayyor" va "Qaytarish" — kassir ham, admin ham, boshqa filial oshpaz yordamchisi ham bosa olmaydi', async () => {
      const order = await orders.createByCashier(c1, { type: 'dine_in', items, payment: 'cash' }, now);
      for (const user of [c1, admin, kitchenY]) {
        await expectCode('forbidden', () => orders.markReady(order.id, user, now));
      }
      expect((await orders.markReady(order.id, kitchenC, now)).status).toBe('ready');
      for (const user of [c1, admin, kitchenY]) {
        await expectCode('forbidden', () => orders.reopen(order.id, user, now));
      }
      expect((await findOrder(order.id)).status).toBe('ready');
    });
  });

  describe("bir vaqtdagi so'rovlar", () => {
    beforeAll(async () => {
      await seedDemo(app, { activity: false }, now);
      await shifts.openOrResume('usr_cashier_c1', C, now);
    });

    it('10 ta parallel buyurtma: raqamlar aynan 1..10, ombordan aynan 10 × retsept', async () => {
      const product = await em.findOneByOrFail(Product, { id: 'burger-classic' });
      const need = new Map<string, number>();
      for (const line of product.recipe)
        need.set(line.ingredientId, (need.get(line.ingredientId) ?? 0) + line.qty);
      const qtyMap = async () =>
        new Map((await warehouse.stockItems(WC)).map((s) => [s.ingredientId, s.qty]));
      const before = await qtyMap();

      const placed = await Promise.all(
        Array.from({ length: 10 }, () =>
          orders.place(
            {
              branchId: C,
              type: 'dine_in',
              source: 'cashier',
              items,
              payment: 'cash',
              cashierId: 'usr_cashier_c1',
            },
            now,
          ),
        ),
      );
      expect(placed.map((o) => o.number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 10 }, (_, i) => i + 1),
      );
      expect(new Set(placed.map((o) => o.id)).size).toBe(10);

      const after = await qtyMap();
      const expected = new Map([...before].map(([id, qty]) => [id, qty - 10 * (need.get(id) ?? 0)]));
      expect(Object.fromEntries(after)).toEqual(Object.fromEntries(expected));
      expect(await em.countBy(StockMovement, { kind: 'sale', warehouseId: WC })).toBe(10 * need.size);
      // navbat davom etadi
      expect(
        (await orders.createByCashier(c1, { type: 'dine_in', items, payment: 'cash' }, now)).number,
      ).toBe(11);
    });

    it('bir buyurtmani bir vaqtda ikki marta bekor qilish — ombor bir marta qaytadi', async () => {
      const order = await orders.createByCashier(c1, { type: 'dine_in', items, payment: 'cash' }, now);
      const mince = await stockQty(WC, 'beef-mince');
      const results = await Promise.allSettled([
        orders.cancel(order.id, c1, now),
        orders.cancel(order.id, admin, now),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected.map((r) => errorCode(r.reason))).toEqual(['invalid_status']);
      expect(await stockQty(WC, 'beef-mince')).toBe(mince + 120);
    });

    it("5 ta parallel ko'chirish qoldiqdan oshsa: ortig'i insufficient_stock, qoldiq manfiy bo'lmaydi", async () => {
      const startC = await stockQty(WC, 'cheddar');
      const startY = await stockQty(WY, 'cheddar');
      const each = 400; // 0,4 kg
      expect(5 * each).toBeGreaterThan(startC);
      expect(startC).toBeGreaterThanOrEqual(each);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          warehouse.createTransfer(
            {
              fromWarehouseId: WC,
              toWarehouseId: WY,
              items: [{ ingredientId: 'cheddar', qty: each / 1000 }],
            },
            'usr_supplier',
            now,
          ),
        ),
      );
      const done = results.filter((r): r is PromiseFulfilledResult<Transfer> => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(done).toHaveLength(Math.floor(startC / each));
      expect(failed.map((r) => errorCode(r.reason))).toEqual(failed.map(() => 'insufficient_stock'));
      expect(failed.length).toBeGreaterThan(0);

      const endC = await stockQty(WC, 'cheddar');
      expect(endC).toBe(startC - done.length * each);
      expect(endC).toBeGreaterThanOrEqual(0);
      expect(await stockQty(WY, 'cheddar')).toBe(startY + done.length * each);
      expect(done.map((r) => r.value.number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: done.length }, (_, i) => i + 1),
      );
    });
  });
});
