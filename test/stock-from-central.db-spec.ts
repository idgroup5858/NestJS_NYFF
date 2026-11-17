import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BranchesService } from '../src/branches/branches.service';
import { newId } from '../src/common/ids';
import { Product } from '../src/menu/product.entity';
import { OrdersService } from '../src/orders/orders.service';
import { ShiftsService } from '../src/shifts/shifts.service';
import { SyncService } from '../src/sync/sync.service';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { LowStockEvents, type LowStockCrossing } from '../src/warehouse/low-stock-events';
import { StockAdjustment } from '../src/warehouse/stock-adjustment.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
import { StockService } from '../src/warehouse/stock.service';
import { Transfer } from '../src/warehouse/transfer.entity';
import { seedDemo } from './fixtures/demo';
import {
  ADMIN_LOGIN,
  BRANCH_CHILONZOR as C,
  BRANCH_YUNUSOBOD as Y,
  WAREHOUSE_CENTRAL as CENTRAL,
} from './fixtures/demo-data';
import { actor, createTestApp } from './test-app';

/**
 * Markazga juda yaqin filial (2026-11-17, Luchvoy — 5 metr): filialda `stockFromCentral` yoqilsa, sotuv retsepti
 * markaziy ombordan ayriladi (kassa, offline sync ham). **Yoqilgan paytda** filial ombori markazga qo'shiladi: minuslar
 * 0 ga ("Tuzatish №N", markazga tegmaydi), plusdagilar markaziy omborga ("Ko'chirish №N"); chegara / norma joyida, "kam
 * qoldi" xabarisiz. O'chirilganda qoldiqqa tegilmaydi. Bekor qilingan buyurtma qaysi ombordan ayrilgan bo'lsa, o'shanga
 * qaytadi; boshqa filiallar o'zgarmaydi.
 */

const now = new Date('2026-11-17T12:00:00');
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const WC = 'wh_chilonzor';
const WY = 'wh_yunusobod';
const BEEF = 'beef-mince';
const ADMIN = 'usr_admin';
const cashierC = actor('usr_cashier_c1', 'cashier', C);
const cashierY = actor('usr_cashier_y1', 'cashier', Y);

describe('filial sotuvi markaziy ombordan', () => {
  let app: INestApplication;
  let ds: DataSource;
  let orders: OrdersService;
  let beefPerBurger: number;
  const http = () => request(app.getHttpServer());
  const crossings: LowStockCrossing[] = [];

  const qtyOf = async (warehouseId: string, ingredientId = BEEF) =>
    (await ds.manager.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;
  const all = async () => ({ central: await qtyOf(CENTRAL), c: await qtyOf(WC), y: await qtyOf(WY) });
  const stockOf = (warehouseId: string) =>
    ds.manager.find(StockItem, { where: { warehouseId }, order: { ingredientId: 'ASC' } });
  const setStock = (warehouseId: string, ingredientId: string, qty: number, minQty = 0) =>
    ds.manager.update(StockItem, { warehouseId, ingredientId }, { qty, minQty });
  const sell = (cashier = cashierC, at = now) =>
    orders.createByCashier(
      cashier,
      { type: 'dine_in', items: [{ productId: 'burger-classic', qty: 1 }], payment: 'cash' },
      at,
    );
  const setFlag = (enabled: boolean, at = now) =>
    app.get(BranchesService).setStockFromCentral(C, enabled, ADMIN, at);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    orders = app.get(OrdersService);
    app.get(LowStockEvents).onLow((list) => crossings.push(...list));
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
    crossings.length = 0;
    const burger = await ds.manager.findOneByOrFail(Product, { id: 'burger-classic' });
    beefPerBurger = burger.recipe.find((line) => line.ingredientId === BEEF)!.qty;
    expect(beefPerBurger).toBeGreaterThan(0);
    await app.get(ShiftsService).openOrResume(cashierC.id, C, now);
    await app.get(ShiftsService).openOrResume(cashierY.id, Y, now);
  });

  afterAll(() => app.close());

  it("switch: standart o'chiq, faqat admin; yo'q filial — 404, noto'g'ri tana — 400", async () => {
    const admin = {
      Authorization: `Bearer ${(await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token}`,
    };
    const supplier = {
      Authorization: `Bearer ${(await http().post('/api/auth/login').send({ userId: 'usr_supplier', pin: '5555' }).expect(200)).body.token}`,
    };
    const put = (id = C) => http().put(`/api/branches/${id}/stock-from-central`);

    const branches = (await http().get('/api/branches').expect(200)).body as { stockFromCentral: boolean }[];
    expect(branches.length).toBeGreaterThan(0);
    expect(branches.every((b) => b.stockFromCentral === false)).toBe(true);

    const before = await stockOf(WC);
    expect((await put().set(supplier).send({ enabled: true }).expect(403)).body.code).toBe('forbidden');
    expect((await put('br_yoq').set(admin).send({ enabled: true }).expect(404)).body.code).toBe('not_found');
    expect((await put().set(admin).send({ enabled: 'ha' }).expect(400)).body.code).toBe('invalid_input');
    // rad etilganlari omborga tegmagan
    expect(await stockOf(WC)).toEqual(before);

    expect((await put().set(admin).send({ enabled: true }).expect(200)).body).toMatchObject({
      id: C,
      stockFromCentral: true,
    });
    expect((await http().get(`/api/branches/${C}`).expect(200)).body.stockFromCentral).toBe(true);
    // hujjatlar admin nomidan
    expect((await ds.manager.find(Transfer)).map((t) => t.createdBy)).toEqual([ADMIN]);
    expect((await put().set(admin).send({ enabled: false }).expect(200)).body.stockFromCentral).toBe(false);
  });

  it('yoqilganda: minuslar 0 ga ("Tuzatish"), plusdagilar markazga ("Ko\'chirish", qadoqlida — donada); chegara joyida, xabarsiz', async () => {
    await ds.manager.update(Ingredient, { id: 'ketchup' }, { packSize: 600 });
    await ds.manager.update(StockItem, { warehouseId: WC }, { qty: 0 });
    await setStock(WC, BEEF, 5000, 1000); // 5 kg → markazga; chegara 1 kg — 0 ga tushsa ham xabar yo'q
    await setStock(WC, 'ketchup', 1500); // 1500 g = 2,5 dona (600 g) → markazga
    await setStock(WC, 'tomato', -700, 200); // minus → 0, markazga tegmaydi
    const centralBefore = await stockOf(CENTRAL);
    const centralQty = async (id: string) => centralBefore.find((s) => s.ingredientId === id)?.qty ?? 0;
    const yunusobod = await stockOf(WY);

    await setFlag(true);

    // filial ombori — hammasi 0, chegara / norma joyida
    const after = await stockOf(WC);
    expect(after.every((s) => s.qty === 0)).toBe(true);
    expect(after.find((s) => s.ingredientId === BEEF)).toMatchObject({ minQty: 1000 });
    expect(after.find((s) => s.ingredientId === 'tomato')).toMatchObject({ minQty: 200 });
    // markaz — plusdagilar qo'shildi, minus (pomidor) tegmadi
    expect(await qtyOf(CENTRAL, BEEF)).toBe((await centralQty(BEEF)) + 5000);
    expect(await qtyOf(CENTRAL, 'ketchup')).toBe((await centralQty('ketchup')) + 1500);
    expect(await qtyOf(CENTRAL, 'tomato')).toBe(await centralQty('tomato'));
    expect(await stockOf(WY)).toEqual(yunusobod);

    // "Tuzatish №1" — faqat minus
    const [adjustment] = await ds.manager.find(StockAdjustment);
    expect(adjustment).toMatchObject({ number: 1, warehouseId: WC, createdBy: ADMIN });
    const adjusts = await ds.manager.findBy(StockMovement, { kind: 'adjust' });
    expect(adjusts).toEqual([
      expect.objectContaining({ warehouseId: WC, ingredientId: 'tomato', qty: 700, refId: adjustment.id }),
    ]);

    // "Ko'chirish" — filial → markaz, ombor birligida (5 kg, 2,5 dona)
    const transfers = await ds.manager.find(Transfer);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      fromWarehouseId: WC,
      toWarehouseId: CENTRAL,
      createdBy: ADMIN,
      items: [
        { ingredientId: BEEF, qty: 5, packSize: null },
        { ingredientId: 'ketchup', qty: 2.5, packSize: 600 },
      ],
    });
    expect(transfers[0].note).toContain('Chilonzor');
    const moved = await ds.manager.findBy(StockMovement, { refId: transfers[0].id });
    expect(moved.map((m) => [m.warehouseId, m.ingredientId, m.qty, m.kind]).sort()).toEqual(
      [
        [CENTRAL, BEEF, 5000, 'transfer_in'],
        [CENTRAL, 'ketchup', 1500, 'transfer_in'],
        [WC, BEEF, -5000, 'transfer_out'],
        [WC, 'ketchup', -1500, 'transfer_out'],
      ].sort(),
    );
    expect(crossings).toEqual([]);
  });

  it("qayta bosish, o'chirish, bo'sh ombor — hech narsa ko'chmaydi", async () => {
    await ds.manager.update(StockItem, { warehouseId: WC }, { qty: 0 });
    await setStock(WC, BEEF, 3000);
    await setFlag(true);
    const centralAfter = await stockOf(CENTRAL);
    const counts = async () => [await ds.manager.count(Transfer), await ds.manager.count(StockAdjustment)];
    expect(await counts()).toEqual([1, 0]);

    // allaqachon yoqiq — ikkinchi marta qo'shilmaydi (filialda yangi qoldiq bo'lsa ham)
    await setStock(WC, BEEF, 400);
    await setFlag(true);
    expect(await qtyOf(WC)).toBe(400);
    expect(await counts()).toEqual([1, 0]);

    // o'chirildi — qoldiqqa tegilmaydi
    await setFlag(false);
    expect(await qtyOf(WC)).toBe(400);
    expect(await stockOf(CENTRAL)).toEqual(centralAfter);

    // filialda hammasi 0 bo'lsa — yoqilganda hujjat yo'q
    await setStock(WC, BEEF, 0);
    await setFlag(true);
    expect(await counts()).toEqual([1, 0]);
    expect(await stockOf(CENTRAL)).toEqual(centralAfter);
  });

  it("o'chiq — filial omboridan (avvalgidek); yoqilgan — markaziy ombordan; boshqa filial o'zgarmaydi", async () => {
    await setStock(WC, BEEF, 10_000);
    const start = await all();
    await sell();
    expect(await all()).toEqual({ ...start, c: start.c - beefPerBurger });

    // yoqildi: filialdagi qoldiq markazga o'tdi
    await setFlag(true);
    const merged = { ...start, central: start.central + start.c - beefPerBurger, c: 0 };
    expect(await all()).toEqual(merged);

    const order = await sell(cashierC, later(1));
    expect(await all()).toEqual({ ...merged, central: merged.central - beefPerBurger });
    const moves = await ds.manager.findBy(StockMovement, { refId: order.id, kind: 'sale' });
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.warehouseId === CENTRAL)).toBe(true);

    // Yunusobod'da yoqilmagan — o'z omboridan
    await sell(cashierY, later(2));
    expect(await all()).toEqual({
      ...merged,
      central: merged.central - beefPerBurger,
      y: start.y - beefPerBurger,
    });

    // o'chirildi — yana filial omboridan (0 dan)
    await setFlag(false);
    await sell(cashierC, later(3));
    expect(await all()).toEqual({
      central: merged.central - beefPerBurger,
      c: -beefPerBurger,
      y: start.y - beefPerBurger,
    });
  });

  it("markaz minusga ham tushadi (savdo to'xtamaydi)", async () => {
    await setStock(CENTRAL, BEEF, 0);
    await setStock(WC, BEEF, 0);
    await setFlag(true);
    await sell();
    expect(await qtyOf(CENTRAL)).toBe(-beefPerBurger);
  });

  it("bekor qilish — qaysi ombordan ayrilgan bo'lsa, o'shanga (switch orada o'zgargan bo'lsa ham)", async () => {
    await setStock(WC, BEEF, 0);
    const start = await all();
    const before = await sell(); // filial omboridan: −120 → yoqilganda 0 ga (markazga tegmaydi)
    await setFlag(true);
    const after = await sell(cashierC, later(1)); // markazdan
    expect(await all()).toEqual({ ...start, central: start.central - beefPerBurger, c: 0 });

    await orders.cancel(before.id, cashierC, later(2));
    expect(await all()).toEqual({ ...start, central: start.central - beefPerBurger, c: beefPerBurger });

    await setFlag(false);
    await orders.cancel(after.id, cashierC, later(3));
    expect(await all()).toEqual({ ...start, c: beefPerBurger });
  });

  it('yoqilayotgan paytdagi sotuvlar: filial omborida hech narsa qolmaydi, hammasi markazdan', async () => {
    await setStock(WC, BEEF, 6000);
    const start = await all();
    const sales = 6;
    await Promise.all([
      ...Array.from({ length: sales }, (_, i) => sell(cashierC, later(i))),
      setFlag(true, later(1)),
    ]);
    // switchdan oldin sotilgani filialdan ayrilib, qolgani markazga o'tdi; keyingilari — markazdan
    expect(await all()).toEqual({ ...start, central: start.central + start.c - sales * beefPerBurger, c: 0 });
  });

  it("switchdan oldin boshlangan sotuv: switch uni kutadi — sotilgani filialdan ayrilib, qolgani markazga o'tadi", async () => {
    await setStock(WC, BEEF, 6000);
    const start = await all();
    const stock = app.get(StockService);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // sotuv tranzaksiyasi filial holatini o'qidi (hali o'chiq) — ayirishdan oldin
      const warehouse = await stock.saleWarehouse(runner.manager, C);
      expect(warehouse.id).toBe(WC);

      let switched = false;
      const toggle = setFlag(true).then(() => (switched = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(switched).toBe(false); // filial qatori band — switch kutyapti

      await stock.applyDeltas(
        runner.manager,
        warehouse.id,
        [{ ingredientId: BEEF, qty: -beefPerBurger }],
        'sale',
        'ord_x',
        now,
      );
      await runner.commitTransaction();
      await toggle;
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    // qulfsiz bo'lganda: switch 6000 ni ko'chirib bo'lardi, keyin sotuv filialni −120 ga tushirardi
    expect(await all()).toEqual({ ...start, central: start.central + start.c - beefPerBurger, c: 0 });
  });

  it('offline kassa sotuvi — markazga yetib kelgan paytdagi switch holati bilan', async () => {
    const offline = (number: number) => ({
      id: newId('ord'),
      number,
      type: 'dine_in' as const,
      items: [
        { productId: 'burger-classic', name: { uz: 'Klassik burger', ru: '', en: '' }, price: 32000, qty: 2 },
      ],
      note: '',
      total: 64000,
      payment: 'cash' as const,
      split: null,
      status: 'preparing' as const,
      cashierId: cashierC.id,
      createdAt: now.toISOString(),
      readyAt: null,
      cancelledAt: null,
      cancelledBy: null,
    });
    await setStock(WC, BEEF, 0);
    const start = await all();
    await setFlag(true);
    const result = await app.get(SyncService).importOrders(C, [offline(101)], later(5));
    expect(result.rejected).toEqual([]);
    expect(await all()).toEqual({ ...start, central: start.central - 2 * beefPerBurger });
  });
});
