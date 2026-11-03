import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { showsOnTv } from '../src/domain/orders';
import { Expense } from '../src/expenses/expense.entity';
import { Category } from '../src/menu/category.entity';
import { Product } from '../src/menu/product.entity';
import { Order } from '../src/orders/order.entity';
import { Shift } from '../src/shifts/shift.entity';
import { ScreenCodesService } from '../src/screens/screen-codes.service';
import { User } from '../src/users/user.entity';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { Purchase } from '../src/warehouse/purchase.entity';
import { Transfer } from '../src/warehouse/transfer.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN } from './fixtures/demo-data';
import { createTestApp } from './test-app';

/** Testlar tayanadigan sinov to'plami (`fixtures/demo`) butunmi — avval ilovaning demo ma'lumoti edi. */
describe("sinov to'plami", () => {
  const now = new Date('2026-10-23T12:00:00');
  const C = 'br_chilonzor';
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(() => app.close());

  const login = (userId: string, pin: string) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ userId, pin });

  it("faqat ma'lumotnomalar (createBaseDb): menyu butun, narxlar, ogohlantirishlar, xodimlar, qurilmalar", async () => {
    await seedDemo(app, { activity: false }, now);
    const em = ds.manager;

    const categories = new Set((await em.find(Category)).map((c) => c.id));
    const ingredients = new Set((await em.find(Ingredient)).map((i) => i.id));
    const products = await em.find(Product);
    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(categories.has(product.categoryId)).toBe(true);
      expect(product.recipe.length).toBeGreaterThan(0);
      for (const line of product.recipe) expect(ingredients.has(line.ingredientId)).toBe(true);
      expect(product.price).toBeGreaterThan(0);
    }
    expect(
      products.filter((p) => p.unavailableBranchIds.length > 0).map((p) => [p.id, p.unavailableBranchIds]),
    ).toEqual([['hotdog-kimchi', ['br_yunusobod']]]);
    expect((await app.get(WarehouseService).lowStock('wh_chilonzor')).length).toBeGreaterThanOrEqual(3);

    const users = await em.find(User);
    expect(users).toHaveLength(10);
    expect(users.filter((u) => u.role === 'courier').every((u) => u.branchIds.length === 0 && !u.onDuty)).toBe(true);
    expect(
      users
        .filter((u) => u.role === 'kitchen')
        .map((u) => u.id)
        .sort(),
    ).toEqual(['usr_kitchen_c1', 'usr_kitchen_y1']);
    // ikonka aniq yozilgan (backendda bo'sh satr — "ikonkasiz")
    expect((await em.findOneByOrFail(Category, { id: 'burgers' })).icon).toBe('/images/icons/hamburger.png');

    // tarix, hujjat va smenalarsiz
    expect(await em.count(Order)).toBe(0);
    expect(await em.count(Shift)).toBe(0);
    expect(await em.count(Purchase)).toBe(0);
    expect(await em.count(Expense)).toBe(0);
  });

  it('jonli demo (createSeedDb): tarix, bugungi buyurtmalar, hujjatlar, chiqimlar', async () => {
    await seedDemo(app, { activity: true }, now);
    const em = ds.manager;

    expect(await em.count(Order)).toBeGreaterThan(1000);
    // Chilonzorda 5 ta tayyorlanmoqda (1 tasi mobil) + 2 ta kassada to'lanadigan kiosk + 1 ta qabul kutayotgan mobil
    const active = await em.findBy(Order, { branchId: C, status: In(['pending', 'preparing']) });
    expect(active).toHaveLength(8);
    expect(await em.countBy(Order, { source: 'mobile', status: 'pending' })).toBe(1);
    const todayStart = new Date(2026, 9, 23);
    const today = (await em.findBy(Order, { branchId: C })).filter(
      (o) => o.createdAt >= todayStart && o.status !== 'cancelled',
    );
    expect(today.length).toBeGreaterThanOrEqual(10);
    expect(await em.countBy(Purchase, { status: 'pending' })).toBe(1);
    expect(await em.count(Transfer)).toBe(3);
    expect(await em.count(Expense)).toBeGreaterThanOrEqual(20);
    expect((await app.get(WarehouseService).lowStock('wh_chilonzor')).length).toBeGreaterThanOrEqual(3);
    // oshxonada TV ga chiqmaydiganlar ham bor (mobil yoki dostavka)
    expect(active.some((o) => o.status === 'preparing' && !showsOnTv(o))).toBe(true);
    // ikkala filialda kassir smenasi ochiq
    expect((await em.find(Shift)).filter((s) => s.closedAt === null)).toHaveLength(2);
  });

  it("oshpaz yordamchisi PIN bilan kiradi, TV navbati — TV kodi bilan; ilovada demo endpoint'i yo'q", async () => {
    const res = await login('usr_kitchen_c1', '1111').expect(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({ id: 'usr_kitchen_c1', role: 'kitchen', branchId: C, surname: 'Qodirov', email: null });

    const tv = await request(app.getHttpServer())
      .get(`/api/tv/queue?branchId=${C}`)
      .set('X-Tv-Code', await app.get(ScreenCodesService).get('tv', C))
      .expect(200);
    expect(Array.isArray(tv.body.preparing)).toBe(true);

    const admin = (await request(app.getHttpServer()).post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body
      .token as string;
    await request(app.getHttpServer()).post('/api/demo/reset').set('Authorization', `Bearer ${admin}`).expect(404);
  });
});
