import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { newId } from '../src/common/ids';
import { dateKey } from '../src/domain/dates';
import { Product } from '../src/menu/product.entity';
import { Order } from '../src/orders/order.entity';
import { orderView } from '../src/orders/order.views';
import { OrdersService } from '../src/orders/orders.service';
import { ReportsService, type ProductProfit } from '../src/reports/reports.service';
import { SyncService } from '../src/sync/sync.service';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C, BRANCH_YUNUSOBOD as Y } from './fixtures/demo-data';
import { createTestApp, expectCode } from './test-app';

/**
 * Taomlar foydasi (2026-11-18): foydalanuvchi — "kola 1 l ni tovar sifatida 12 000 ga qo'shaman, menyuda 14 000".
 * Sotuv paytida har qatorning tannarxi (retsept × ombor mahsulotining oxirgi narxi) buyurtmaga yoziladi
 * (`orders.itemCosts`), narx keyin o'zgarsa ham o'tgan sotuvniki o'zgarmaydi; eski (tannarxsiz) sotuvlar noma'lum
 * qoladi. Tannarx faqat admin hisobotida (`GET /reports/products`) — kassa, oshxona, mijozga chiqmaydi.
 */

const name = (uz: string) => ({ uz, ru: `${uz} ru`, en: `${uz} en` });
const CASHIER = 'usr_cashier_c1';

describe('taomlar foydasi (sotuv paytidagi tannarx)', () => {
  let app: INestApplication;
  let db: DataSource;
  let orders: OrdersService;
  let reports: ReportsService;
  const http = () => request(app.getHttpServer());
  const login = async (body: object, path = '/api/auth/login') =>
    `Bearer ${(await http().post(path).send(body).expect(200)).body.token as string}`;
  const today = () => dateKey(new Date());
  const costsOf = async (orderId: string): Promise<(number | null)[] | null> =>
    (await db.query(`SELECT "itemCosts" FROM orders WHERE id = $1`, [orderId]))[0].itemCosts;
  /** filialda to'langan kiosk buyurtmasi (smenasiz) */
  const sell = (items: { productId: string; qty: number }[], branchId = C, payment: 'card' | null = 'card') =>
    orders.place({ branchId, type: 'takeaway', source: 'kiosk', items, payment, cashierId: null });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    orders = app.get(OrdersService);
    reports = app.get(ReportsService);
    await seedDemo(app, { activity: false });

    await db.manager.insert(Ingredient, [
      { id: 'ing_cola', name: name('Cola 1 l'), group: 'drinks', unit: 'pcs', packSize: null, lastPrice: 12000 },
      { id: 'ing_mince', name: name('Qiyma'), group: 'meat', unit: 'kg', packSize: null, lastPrice: 100000 },
      { id: 'ing_bun', name: name('Non'), group: 'bread', unit: 'pcs', packSize: null, lastPrice: 2000 },
      // narxi hali yozilmagan sous (600 g lik qadoq)
      { id: 'ing_sauce', name: name('Sous'), group: 'sauces', unit: 'kg', packSize: 600, lastPrice: null },
    ]);
    const product = (id: string, categoryId: string, price: number, recipe: Product['recipe']) => ({
      id,
      categoryId,
      name: name(id),
      recipe,
      price,
      sortOrder: 100,
    });
    await db.manager.insert(Product, [
      product('p_cola', 'drinks', 14000, [{ ingredientId: 'ing_cola', qty: 1 }]),
      // 150 g × 100 000 / kg + 1 × 2 000 = 17 000
      product('p_burger', 'burgers', 30000, [
        { ingredientId: 'ing_mince', qty: 150 },
        { ingredientId: 'ing_bun', qty: 1 },
      ]),
      product('p_hotdog', 'hotdogs', 20000, [
        { ingredientId: 'ing_bun', qty: 1 },
        { ingredientId: 'ing_sauce', qty: 50 },
      ]),
    ]);
  });

  afterAll(() => app.close());

  it("sotuvda har qatorga 1 dona tannarx yoziladi; narxsiz mahsulotli taom — null; buyurtma o'qilganda kelmaydi", async () => {
    const order = await sell([
      { productId: 'p_cola', qty: 2 },
      { productId: 'p_burger', qty: 1 },
      { productId: 'p_hotdog', qty: 1 },
    ]);
    expect(await costsOf(order.id)).toEqual([12000, 17000, null]);
    // `select: false` — oddiy o'qishda yo'q; xodim ko'rinishida ham yo'q
    expect((await db.manager.findOneByOrFail(Order, { id: order.id })).itemCosts).toBeUndefined();
    expect(order.itemCosts).toEqual([12000, 17000, null]);
    expect('itemCosts' in orderView(order)).toBe(false);
  });

  it("kirim narxi keyin o'zgarsa — yangi sotuv yangi narxda, o'tgani o'zgarmaydi", async () => {
    const before = await sell([{ productId: 'p_cola', qty: 1 }]);
    await db.manager.update(Ingredient, 'ing_cola', { lastPrice: 13000 });
    const after = await sell([{ productId: 'p_cola', qty: 1 }]);
    expect(await costsOf(before.id)).toEqual([12000]);
    expect(await costsOf(after.id)).toEqual([13000]);
    await db.manager.update(Ingredient, 'ing_cola', { lastPrice: 12000 });
  });

  it("offline kassa buyurtmasi — markazga yetib kelgan paytdagi narx bilan; menyuda yo'q taom — null", async () => {
    const id = newId('ord');
    const result = await app.get(SyncService).importOrders(C, [
      {
        id,
        number: 900,
        type: 'dine_in',
        items: [
          { productId: 'p_burger', name: name('p_burger'), price: 30000, qty: 1 },
          { productId: 'p_deleted', name: name('O\'chirilgan'), price: 5000, qty: 1 },
        ],
        note: '',
        total: 35000,
        payment: 'cash',
        split: null,
        status: 'preparing',
        cashierId: CASHIER,
        createdAt: new Date().toISOString(),
        readyAt: null,
        cancelledAt: null,
        cancelledBy: null,
      },
    ]);
    expect(result.accepted).toEqual([id]);
    expect(await costsOf(id)).toEqual([17000, null]);
  });

  it("kassa javobi, kassa ro'yxati va admin buyurtma oynasida tannarx yo'q", async () => {
    const cashier = await login({ userId: CASHIER, pin: '1234' });
    const created = await http()
      .post('/api/orders')
      .set({ Authorization: cashier })
      .send({ type: 'dine_in', items: [{ productId: 'p_cola', qty: 1 }], payment: 'cash' })
      .expect(201);
    expect(created.body).not.toHaveProperty('itemCosts');
    expect(await costsOf(created.body.id)).toEqual([12000]);

    const active = await http().get('/api/orders/active').set({ Authorization: cashier }).expect(200);
    expect(active.body.length).toBeGreaterThan(0);
    for (const order of active.body) expect(order).not.toHaveProperty('itemCosts');

    const admin = await login(ADMIN_LOGIN, '/api/auth/admin-login');
    const shown = await http().get(`/api/orders/${created.body.id}`).set({ Authorization: admin }).expect(200);
    expect(shown.body).not.toHaveProperty('itemCosts');
  });

  describe('hisobot', () => {
    let expected: Record<string, Omit<ProductProfit, 'name'>>;

    beforeAll(async () => {
      // shu paytgacha (yuqoridagi testlar): kola 2+1+1+1 = 5 ta (12 000, 12 000, 13 000, 12 000 kassa), burger 1 + 1
      // (offline), hot-dog 1 (tannarxsiz), o'chirilgan taom 1 (tannarxsiz)
      // eski buyurtma — tannarx yozilmagan (ustun `null`): soni va tushumga kiradi, foydaga kirmaydi
      const old = await sell([{ productId: 'p_burger', qty: 2 }]);
      await db.query(`UPDATE orders SET "itemCosts" = NULL WHERE id = $1`, [old.id]);
      // bekor qilingan va to'lanmagan — hisobotga kirmaydi
      const cancelled = await sell([{ productId: 'p_cola', qty: 10 }]);
      await db.query(`UPDATE orders SET status = 'cancelled', "cancelledAt" = now() WHERE id = $1`, [cancelled.id]);
      await sell([{ productId: 'p_cola', qty: 7 }], C, null);
      // boshqa filial
      await sell([{ productId: 'p_cola', qty: 4 }], Y);

      expected = {
        p_burger: { productId: 'p_burger', qty: 4, revenue: 120000, costedQty: 2, costedRevenue: 60000, cost: 34000 },
        p_cola: { productId: 'p_cola', qty: 5, revenue: 70000, costedQty: 5, costedRevenue: 70000, cost: 61000 },
        p_hotdog: { productId: 'p_hotdog', qty: 1, revenue: 20000, costedQty: 0, costedRevenue: 0, cost: 0 },
        p_deleted: { productId: 'p_deleted', qty: 1, revenue: 5000, costedQty: 0, costedRevenue: 0, cost: 0 },
      };
    });

    it("filial bo'yicha: soni, tushum, tannarxi ma'lum qismi va tannarx; tartib — tushum bo'yicha", async () => {
      const rows = await reports.products({ from: today(), to: today(), branchId: C });
      expect(rows.map(({ name: _name, ...row }) => row)).toEqual([
        expected.p_burger,
        expected.p_cola,
        expected.p_hotdog,
        expected.p_deleted,
      ]);
      // foyda: burger 60 000 − 34 000, kola 70 000 − 61 000
      expect(rows[0].costedRevenue - rows[0].cost).toBe(26000);
      expect(rows[1].costedRevenue - rows[1].cost).toBe(9000);
    });

    it("sotuv hisobotidagi taomlar bilan bir xil qatorlar, nom, soni va tushum", async () => {
      for (const branchId of [C, null]) {
        const range = { from: today(), to: today(), branchId };
        const [rows, sales] = await Promise.all([reports.products(range), reports.sales(range)]);
        expect(rows.map(({ productId, name: label, qty, revenue }) => ({ productId, name: label, qty, revenue }))).toEqual(
          sales.topProducts,
        );
      }
      // barcha filiallar: Yunusobod'dagi 4 ta kola ham (12 000 dan)
      const all = await reports.products({ from: today(), to: today(), branchId: null });
      expect(all.find((row) => row.productId === 'p_cola')).toMatchObject({ qty: 9, costedQty: 9, cost: 61000 + 48000 });
    });

    it("bo'sh davr, from > to — bo'sh; haqiqiy bo'lmagan sana — invalid_input", async () => {
      expect(await reports.products({ from: '2020-01-01', to: '2020-01-31', branchId: null })).toEqual([]);
      expect(await reports.products({ from: today(), to: '2020-01-01', branchId: null })).toEqual([]);
      await expectCode('invalid_input', () => reports.products({ from: '2026-02-30', to: '2026-03-01', branchId: null }));
    });

    it('HTTP: admin — 200 (servis bilan bir xil), kassir — 403, tokensiz — 401', async () => {
      const admin = await login(ADMIN_LOGIN, '/api/auth/admin-login');
      const res = await http()
        .get('/api/reports/products')
        .query({ from: today(), to: today(), branchId: C })
        .set({ Authorization: admin })
        .expect(200);
      expect(res.body).toEqual(await reports.products({ from: today(), to: today(), branchId: C }));
      const bad = await http().get('/api/reports/products').query({ from: '18.11.2026', to: today() }).set({ Authorization: admin }).expect(400);
      expect(bad.body.code).toBe('invalid_input');

      const cashier = await login({ userId: CASHIER, pin: '1234' });
      const forbidden = await http()
        .get('/api/reports/products')
        .query({ from: today(), to: today() })
        .set({ Authorization: cashier })
        .expect(403);
      expect(forbidden.body.code).toBe('forbidden');
      await http().get('/api/reports/products').query({ from: today(), to: today() }).expect(401);
    });
  });
});
