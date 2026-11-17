import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BranchesService } from '../src/branches/branches.service';
import { newId } from '../src/common/ids';
import { Product } from '../src/menu/product.entity';
import { OrdersService } from '../src/orders/orders.service';
import { ShiftsService } from '../src/shifts/shifts.service';
import { SyncService } from '../src/sync/sync.service';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
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
 * markaziy ombordan ayriladi (kassa, offline sync ham). Switch qoldiqni ko'chirmaydi, filial omboriga tegmaydi; bekor
 * qilingan buyurtma qaysi ombordan ayrilgan bo'lsa, o'shanga qaytadi; boshqa filiallar o'zgarmaydi.
 */

const now = new Date('2026-11-17T12:00:00');
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const WC = 'wh_chilonzor';
const WY = 'wh_yunusobod';
const BEEF = 'beef-mince';
const cashierC = actor('usr_cashier_c1', 'cashier', C);
const cashierY = actor('usr_cashier_y1', 'cashier', Y);

describe('filial sotuvi markaziy ombordan', () => {
  let app: INestApplication;
  let ds: DataSource;
  let orders: OrdersService;
  let beefPerBurger: number;
  const http = () => request(app.getHttpServer());

  const beef = async (warehouseId: string) =>
    (await ds.manager.findOneBy(StockItem, { warehouseId, ingredientId: BEEF }))?.qty ?? 0;
  const all = async () => ({ central: await beef(CENTRAL), c: await beef(WC), y: await beef(WY) });
  const sell = (cashier = cashierC, at = now) =>
    orders.createByCashier(
      cashier,
      { type: 'dine_in', items: [{ productId: 'burger-classic', qty: 1 }], payment: 'cash' },
      at,
    );
  const setFlag = (enabled: boolean) => app.get(BranchesService).setStockFromCentral(C, enabled);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    orders = app.get(OrdersService);
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
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

    expect((await put().set(supplier).send({ enabled: true }).expect(403)).body.code).toBe('forbidden');
    expect((await put('br_yoq').set(admin).send({ enabled: true }).expect(404)).body.code).toBe('not_found');
    expect((await put().set(admin).send({ enabled: 'ha' }).expect(400)).body.code).toBe('invalid_input');

    expect((await put().set(admin).send({ enabled: true }).expect(200)).body).toMatchObject({
      id: C,
      stockFromCentral: true,
    });
    expect((await http().get(`/api/branches/${C}`).expect(200)).body.stockFromCentral).toBe(true);
    expect((await put().set(admin).send({ enabled: false }).expect(200)).body.stockFromCentral).toBe(false);
  });

  it("o'chiq — filial omboridan (avvalgidek); yoqilgan — markaziy ombordan; boshqa filial o'zgarmaydi", async () => {
    const start = await all();
    await sell();
    expect(await all()).toEqual({ ...start, c: start.c - beefPerBurger });

    // yoqildi: qoldiq ko'chirilmaydi, filial ombori joyida
    await setFlag(true);
    expect(await all()).toEqual({ ...start, c: start.c - beefPerBurger });

    const order = await sell(cashierC, later(1));
    expect(await all()).toEqual({
      ...start,
      central: start.central - beefPerBurger,
      c: start.c - beefPerBurger,
    });
    const moves = await ds.manager.findBy(StockMovement, { refId: order.id, kind: 'sale' });
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.warehouseId === CENTRAL)).toBe(true);

    // Yunusobod'da yoqilmagan — o'z omboridan
    await sell(cashierY, later(2));
    expect(await all()).toEqual({
      central: start.central - beefPerBurger,
      c: start.c - beefPerBurger,
      y: start.y - beefPerBurger,
    });

    // o'chirildi — yana filial omboridan
    await setFlag(false);
    await sell(cashierC, later(3));
    expect(await all()).toEqual({
      central: start.central - beefPerBurger,
      c: start.c - 2 * beefPerBurger,
      y: start.y - beefPerBurger,
    });
  });

  it("markaz minusga ham tushadi (savdo to'xtamaydi)", async () => {
    await ds.manager.update(StockItem, { warehouseId: CENTRAL, ingredientId: BEEF }, { qty: 0 });
    await setFlag(true);
    await sell();
    expect(await beef(CENTRAL)).toBe(-beefPerBurger);
  });

  it("bekor qilish — qaysi ombordan ayrilgan bo'lsa, o'shanga (switch orada o'zgargan bo'lsa ham)", async () => {
    const start = await all();
    const before = await sell(); // filial omboridan
    await setFlag(true);
    const after = await sell(cashierC, later(1)); // markazdan
    expect(await all()).toEqual({
      ...start,
      central: start.central - beefPerBurger,
      c: start.c - beefPerBurger,
    });

    await orders.cancel(before.id, cashierC, later(2));
    expect(await all()).toEqual({ ...start, central: start.central - beefPerBurger });

    await setFlag(false);
    await orders.cancel(after.id, cashierC, later(3));
    expect(await all()).toEqual(start);
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
    const start = await all();
    await setFlag(true);
    const result = await app.get(SyncService).importOrders(C, [offline(101)], later(5));
    expect(result.rejected).toEqual([]);
    expect(await all()).toEqual({ ...start, central: start.central - 2 * beefPerBurger });
  });
});
