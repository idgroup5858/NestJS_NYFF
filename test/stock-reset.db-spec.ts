import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Product } from '../src/menu/product.entity';
import { OrdersService } from '../src/orders/orders.service';
import { ShiftsService } from '../src/shifts/shifts.service';
import { LowStockEvents, type LowStockCrossing } from '../src/warehouse/low-stock-events';
import { StockAdjustment } from '../src/warehouse/stock-adjustment.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C, WAREHOUSE_CENTRAL as CENTRAL } from './fixtures/demo-data';
import { actor, createTestApp } from './test-app';

/**
 * Qoldiqni 0 ga tushirish (2026-11-10): hisob yuritilmagan davrdan keyin "toza boshlash" — bitta mahsulot yoki butun
 * ombor (minus ham, plus ham), faqat admin. Har biriga teskari `adjust` harakati ("Tuzatish №N", kim yozgani bilan);
 * chegara / norma, boshqa omborlar o'zgarmaydi, "kam qoldi" xabari ketmaydi; sotuv keyin odatdagidek 0 dan ayiradi.
 *
 * Qoldiqni qo'lda yozish (2026-11-15, admin va ta'minotchi): farqi (yangi − hozirgi) — o'sha `adjust` / "Tuzatish №N".
 */

const now = new Date('2026-11-10T12:00:00');
const WC = 'wh_chilonzor';
const ADMIN = 'usr_admin';
const cashier = actor('usr_cashier_c1', 'cashier', C);

describe('qoldiqni 0 ga tushirish', () => {
  let app: INestApplication;
  let ds: DataSource;
  let warehouse: WarehouseService;
  const http = () => request(app.getHttpServer());
  const crossings: LowStockCrossing[] = [];

  const stockOf = (warehouseId: string) =>
    ds.manager.find(StockItem, { where: { warehouseId }, order: { ingredientId: 'ASC' } });
  const setStock = (ingredientId: string, qty: number, minQty = 0, targetQty = 0) =>
    ds.manager.update(StockItem, { warehouseId: WC, ingredientId }, { qty, minQty, targetQty });
  const qtyOf = async (ingredientId: string) =>
    (await ds.manager.findOneByOrFail(StockItem, { warehouseId: WC, ingredientId })).qty;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    warehouse = app.get(WarehouseService);
    app.get(LowStockEvents).onLow((list) => crossings.push(...list));
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
    crossings.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('bitta mahsulot: minus → 0, tarixda "Tuzatish №1" (kim yozgani bilan); 0 bo\'lsa — hujjatsiz; faqat admin', async () => {
    const admin = {
      Authorization: `Bearer ${(await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token}`,
    };
    const supplierToken = (
      await http().post('/api/auth/login').send({ userId: 'usr_supplier', pin: '5555' }).expect(200)
    ).body.token as string;
    const supplier = { Authorization: `Bearer ${supplierToken}` };

    await setStock('ketchup', -1250, 1200, 3000);
    const others = (await stockOf(WC)).filter((s) => s.ingredientId !== 'ketchup');

    await http().post(`/api/stock/${WC}/ketchup/reset`).set(supplier).expect(403);
    expect(await qtyOf('ketchup')).toBe(-1250);

    const reset = await http().post(`/api/stock/${WC}/ketchup/reset`).set(admin).expect(200);
    expect(reset.body).toMatchObject({
      count: 1,
      adjustment: { number: 1, warehouseId: WC, createdBy: ADMIN },
    });
    // chegara va norma joyida, boshqa mahsulotlar o'zgarmagan
    expect(
      await ds.manager.findOneByOrFail(StockItem, { warehouseId: WC, ingredientId: 'ketchup' }),
    ).toMatchObject({
      qty: 0,
      minQty: 1200,
      targetQty: 3000,
    });
    expect((await stockOf(WC)).filter((s) => s.ingredientId !== 'ketchup')).toEqual(others);

    const history = await http()
      .get('/api/movements')
      .query({ warehouseId: WC, ingredientId: 'ketchup' })
      .set(admin)
      .expect(200);
    expect(history.body.items[0]).toMatchObject({
      kind: 'adjust',
      qty: 1250,
      refId: reset.body.adjustment.id,
      refNumber: 1,
      refWarehouseId: null,
      refBy: ADMIN,
    });

    // allaqachon 0 — hech narsa yozilmaydi
    const again = await http().post(`/api/stock/${WC}/ketchup/reset`).set(admin).expect(200);
    expect(again.body).toEqual({ adjustment: null, count: 0 });
    expect(await ds.manager.count(StockAdjustment)).toBe(1);

    expect((await http().post(`/api/stock/${WC}/nope/reset`).set(admin).expect(404)).body.code).toBe(
      'not_found',
    );
    expect((await http().post('/api/stock/wh_nope/reset').set(admin).expect(404)).body.code).toBe(
      'not_found',
    );
  });

  it('butun ombor: minus ham, plus ham → 0, bitta hujjat; boshqa omborlar o\'zgarmaydi; "kam qoldi" xabari yo\'q', async () => {
    await setStock('ketchup', -500, 1200);
    await setStock('sausage', 4000, 10); // 4000 → 0 — chegaradan tushadi, lekin xabar ketmasligi kerak
    const before = await stockOf(WC);
    const changed = before.filter((s) => s.qty !== 0);
    expect(changed.length).toBeGreaterThan(2);
    const central = await stockOf(CENTRAL);
    const yunusobod = await stockOf('wh_yunusobod');

    const result = await warehouse.resetStock(WC, undefined, ADMIN, now);
    expect(result.count).toBe(changed.length);
    expect(result.adjustment).toMatchObject({ number: 1, warehouseId: WC, createdBy: ADMIN });

    const after = await stockOf(WC);
    expect(after.every((s) => s.qty === 0)).toBe(true);
    expect(after.map(({ minQty, targetQty }) => ({ minQty, targetQty }))).toEqual(
      before.map(({ minQty, targetQty }) => ({ minQty, targetQty })),
    );
    expect(await stockOf(CENTRAL)).toEqual(central);
    expect(await stockOf('wh_yunusobod')).toEqual(yunusobod);

    // har bir mahsulotga bitta teskari harakat
    const movements = await ds.manager.findBy(StockMovement, { kind: 'adjust' });
    expect(movements).toHaveLength(changed.length);
    expect(movements.every((m) => m.warehouseId === WC && m.refId === result.adjustment!.id)).toBe(true);
    expect(new Map(movements.map((m) => [m.ingredientId, -m.qty]))).toEqual(
      new Map(changed.map((s) => [s.ingredientId, s.qty])),
    );
    expect(crossings).toEqual([]);

    // hammasi 0 — ikkinchi marta hech narsa
    expect(await warehouse.resetStock(WC, undefined, ADMIN, now)).toEqual({ adjustment: null, count: 0 });
  });

  it("0 dan keyin sotuv odatdagidek ayiriladi (minus — yana ko'rinadi), keyingi tuzatish — №2", async () => {
    await app.get(ShiftsService).openOrResume(cashier.id, C, now);
    await warehouse.resetStock(WC, undefined, ADMIN, now);

    const hotdog = await ds.manager.findOneByOrFail(Product, { id: 'hotdog-classic' });
    const ketchupPerHotdog = hotdog.recipe.find((line) => line.ingredientId === 'ketchup')!.qty;
    await app
      .get(OrdersService)
      .createByCashier(
        cashier,
        { type: 'dine_in', items: [{ productId: 'hotdog-classic', qty: 2 }], payment: 'cash' },
        now,
      );
    expect(await qtyOf('ketchup')).toBe(-2 * ketchupPerHotdog);
    expect(await ds.manager.countBy(StockMovement, { kind: 'sale', warehouseId: WC })).toBeGreaterThan(0);

    const second = await warehouse.resetStock(WC, 'ketchup', ADMIN, now);
    expect(second).toMatchObject({ count: 1, adjustment: { number: 2 } });
    expect(await qtyOf('ketchup')).toBe(0);
  });

  describe("qoldiqni qo'lda yozish", () => {
    const login = async (userId: string, pin: string) => ({
      Authorization: `Bearer ${(await http().post('/api/auth/login').send({ userId, pin }).expect(200)).body.token}`,
    });
    const put = (ingredientId: string, qty: unknown, warehouseId = WC) =>
      http().put(`/api/stock/${warehouseId}/${ingredientId}/qty`).send({ qty });

    it("ta'minotchi: minus → yozilgan son, farqi — \"Tuzatish №1\" (kim yozgani bilan); chegara / norma joyida; xabarsiz", async () => {
      const supplier = await login('usr_supplier', '5555');
      await setStock('ketchup', -1250, 1200, 3000);
      const others = (await stockOf(WC)).filter((s) => s.ingredientId !== 'ketchup');

      const saved = await put('ketchup', 3000).set(supplier).expect(200);
      expect(saved.body).toMatchObject({
        count: 1,
        adjustment: { number: 1, warehouseId: WC, createdBy: 'usr_supplier' },
      });
      expect(
        await ds.manager.findOneByOrFail(StockItem, { warehouseId: WC, ingredientId: 'ketchup' }),
      ).toMatchObject({ qty: 3000, minQty: 1200, targetQty: 3000 });
      expect((await stockOf(WC)).filter((s) => s.ingredientId !== 'ketchup')).toEqual(others);

      // chegaradan pastga tushirish ham — "kam qoldi" xabarisiz
      await put('ketchup', 500).set(supplier).expect(200);
      expect(await qtyOf('ketchup')).toBe(500);
      expect(crossings).toEqual([]);

      const history = await http()
        .get('/api/movements')
        .query({ warehouseId: WC, ingredientId: 'ketchup' })
        .set(supplier)
        .expect(200);
      expect(history.body.items.slice(0, 2)).toMatchObject([
        { kind: 'adjust', qty: -2500, refNumber: 2, refBy: 'usr_supplier' },
        { kind: 'adjust', qty: 4250, refNumber: 1, refBy: 'usr_supplier', refId: saved.body.adjustment.id },
      ]);

      // hozirgisi bilan bir xil — hech narsa yozilmaydi
      expect((await put('ketchup', 500).set(supplier).expect(200)).body).toEqual({ adjustment: null, count: 0 });
      expect(await ds.manager.count(StockAdjustment)).toBe(2);
    });

    it('qoldiq yozuvi yo\'q mahsulot — yangi yozuv (chegarasiz); admin ham yozadi', async () => {
      const admin = {
        Authorization: `Bearer ${(await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token}`,
      };
      await ds.manager.delete(StockItem, { warehouseId: WC, ingredientId: 'ketchup' });
      const saved = await put('ketchup', 750).set(admin).expect(200);
      expect(saved.body).toMatchObject({ count: 1, adjustment: { createdBy: ADMIN } });
      expect(
        await ds.manager.findOneByOrFail(StockItem, { warehouseId: WC, ingredientId: 'ketchup' }),
      ).toMatchObject({ qty: 750, minQty: 0, targetQty: 0 });
    });

    it('xatolar: butun 0…1 mlrd emas — invalid_qty, yo\'q ombor / mahsulot — not_found, kassa xodimi — forbidden', async () => {
      const supplier = await login('usr_supplier', '5555');
      await setStock('ketchup', 1000);
      for (const qty of [-1, 1.5, 1_000_000_001]) {
        expect((await put('ketchup', qty).set(supplier).expect(400)).body.code).toBe('invalid_qty');
      }
      expect((await put('ketchup', '5').set(supplier).expect(400)).body.code).toBe('invalid_input');
      expect((await put('nope', 5).set(supplier).expect(404)).body.code).toBe('not_found');
      expect((await put('ketchup', 5, 'wh_nope').set(supplier).expect(404)).body.code).toBe('not_found');
      const kitchen = await login('usr_kitchen_c1', '1111');
      expect((await put('ketchup', 5).set(kitchen).expect(403)).body.code).toBe('forbidden');
      expect(await qtyOf('ketchup')).toBe(1000);
      expect(await ds.manager.count(StockAdjustment)).toBe(0);
    });

    it('keyingi sotuv yangi qoldiqdan ayriladi; raqamlash 0 ga tushirish bilan umumiy', async () => {
      await app.get(ShiftsService).openOrResume(cashier.id, C, now);
      await warehouse.resetStock(WC, 'ketchup', ADMIN, now);
      expect(await warehouse.setStockQty(WC, 'ketchup', 2000, 'usr_supplier', now)).toMatchObject({
        count: 1,
        adjustment: { number: 2 },
      });

      const hotdog = await ds.manager.findOneByOrFail(Product, { id: 'hotdog-classic' });
      const ketchupPerHotdog = hotdog.recipe.find((line) => line.ingredientId === 'ketchup')!.qty;
      await app
        .get(OrdersService)
        .createByCashier(
          cashier,
          { type: 'dine_in', items: [{ productId: 'hotdog-classic', qty: 2 }], payment: 'cash' },
          now,
        );
      expect(await qtyOf('ketchup')).toBe(2000 - 2 * ketchupPerHotdog);
    });
  });
});
