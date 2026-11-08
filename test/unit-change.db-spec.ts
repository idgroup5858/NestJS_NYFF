import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { StockUnit } from '../src/common/enums';
import { Product } from '../src/menu/product.entity';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { Purchase } from '../src/warehouse/purchase.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { Transfer } from '../src/warehouse/transfer.entity';
import { WarehouseService, type IngredientUsage } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, WAREHOUSE_CENTRAL as CENTRAL } from './fixtures/demo-data';
import { createTestApp, expectCode } from './test-app';

/**
 * Birlikni o'zgartirish (2026-11-08): ishlatilgan mahsulotda ham — faqat admin, web avval ogohlantiradi. Sonlar
 * o'zgarmaydi (qoldiq, chegara, retsept, qadoq hajmi, hujjatlar) — endi yangi birlikda o'qiladi. kg / l ↔ dona: narx
 * yuborilmasa bo'shaydi, tasdiq kutayotgan eski kirimda bo'lsa — `pending_purchase`. kg ↔ l — sonlar to'g'ri qoladi.
 */

const now = new Date('2026-11-08T12:00:00');
const WC = 'wh_chilonzor';
const KETCHUP_NAME = { uz: 'Ketchup', ru: 'Кетчуп', en: 'Ketchup' };

describe("ombor mahsuloti birligini o'zgartirish", () => {
  let app: INestApplication;
  let ds: DataSource;
  let warehouse: WarehouseService;
  const http = () => request(app.getHttpServer());

  const ketchup = () => ds.manager.findOneByOrFail(Ingredient, { id: 'ketchup' });
  const saveKetchup = (
    patch: { unit?: StockUnit; packSize?: number | null; lastPrice?: number | null },
    role: 'admin' | 'supplier',
  ) =>
    warehouse.saveIngredient(
      { id: 'ketchup', name: KETCHUP_NAME, group: 'sauces', active: true, ...patch },
      role,
    );
  /** birlik o'zgarganda tegilmasligi kerak bo'lgan hamma son */
  const numbers = async () => ({
    stock: await ds.manager.find(StockItem, {
      where: { ingredientId: 'ketchup' },
      order: { warehouseId: 'ASC' },
    }),
    recipes: (await ds.manager.find(Product, { order: { id: 'ASC' } })).map((p) => p.recipe),
    purchases: (await ds.manager.find(Purchase, { order: { number: 'ASC' } })).map((p) => p.items),
    transfers: (await ds.manager.find(Transfer, { order: { number: 'ASC' } })).map((t) => t.items),
    movements: await ds.query(`SELECT qty FROM stock_movements WHERE "ingredientId" = 'ketchup' ORDER BY id`),
  });
  /** 2026-11-08 gacha yozilgan, tasdiq kutayotgan kirim: 12,5 kg ketchup */
  const insertPending = () =>
    ds.manager.insert(Purchase, {
      id: 'pur_legacy',
      number: 900,
      warehouseId: CENTRAL,
      items: [{ ingredientId: 'ketchup', qty: 12.5, price: 28000, packSize: null }],
      note: '',
      status: 'pending',
      createdBy: 'usr_supplier',
      createdAt: now,
      decidedBy: null,
      decidedAt: null,
    });

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    warehouse = app.get(WarehouseService);
  });

  beforeEach(() => seedDemo(app, { activity: false }, now));

  afterAll(() => app.close());

  it("kg → dona: sonlar o'zgarmaydi, narx yuborilmasa bo'shaydi; admin yozgan narx — yangi birlikda", async () => {
    await ds.manager.update(
      StockItem,
      { warehouseId: WC, ingredientId: 'ketchup' },
      { qty: 5950, minQty: 1200 },
    );
    await saveKetchup({ packSize: 900 }, 'admin');
    await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: 'ketchup', qty: 3 }] },
      'usr_supplier',
      now,
    );
    await warehouse.createTransfer(
      { fromWarehouseId: CENTRAL, toWarehouseId: WC, items: [{ ingredientId: 'ketchup', qty: 1 }] },
      'usr_supplier',
      now,
    );
    const before = await numbers();

    expect(await saveKetchup({ unit: 'pcs' }, 'admin')).toMatchObject({
      unit: 'pcs',
      packSize: 900,
      lastPrice: null,
    });
    expect(await numbers()).toEqual(before);

    // qaytib kg ga, narxni admin yangi birlikda yozdi (qadoq hajmi ham o'sha so'rovda)
    expect(await saveKetchup({ unit: 'kg', packSize: 600, lastPrice: 17000 }, 'admin')).toMatchObject({
      unit: 'kg',
      packSize: 600,
      lastPrice: 17000,
    });
    expect((await numbers()).stock).toEqual(before.stock);
  });

  it("kg ↔ l: narx va sonlar to'g'ri qoladi, eski kutayotgan kirim xalaqit bermaydi; qadoq bilan narx o'giriladi", async () => {
    await insertPending();
    const before = await numbers();
    expect(await saveKetchup({ unit: 'l' }, 'admin')).toMatchObject({ unit: 'l', lastPrice: 28000 });
    expect(await numbers()).toEqual(before);
    // l → kg va 600 g lik qadoq, narx yuborilmadi: 28 000 / l → 16 800 / dona
    expect(await saveKetchup({ unit: 'kg', packSize: 600 }, 'admin')).toMatchObject({
      unit: 'kg',
      packSize: 600,
      lastPrice: 16800,
    });
  });

  it("ta'minotchi birlikni o'zgartira olmaydi; o'sha birlik yuborilsa — odatdagi tahrir", async () => {
    await expectCode('forbidden', () => saveKetchup({ unit: 'pcs' }, 'supplier'));
    await expectCode('forbidden', () => saveKetchup({ unit: 'l' }, 'supplier'));
    expect((await ketchup()).unit).toBe('kg');
    expect(await saveKetchup({ unit: 'kg', packSize: 600 }, 'supplier')).toMatchObject({
      unit: 'kg',
      packSize: 600,
      lastPrice: 16800,
    });
  });

  it("tasdiq kutayotgan eski kirimda bo'lsa kg → dona — pending_purchase; rad etilgach — o'zgaradi", async () => {
    await insertPending();
    await expectCode('pending_purchase', () => saveKetchup({ unit: 'pcs', lastPrice: 5000 }, 'admin'));
    expect(await ketchup()).toMatchObject({ unit: 'kg', lastPrice: 28000 });

    await warehouse.rejectPurchase('pur_legacy', 'usr_admin', now);
    expect(await saveKetchup({ unit: 'pcs', lastPrice: 5000 }, 'admin')).toMatchObject({
      unit: 'pcs',
      lastPrice: 5000,
    });
  });

  it("HTTP: usage — taomlar, qoldiq / chegara, hujjatlar soni (faqat admin); noto'g'ri birlik — 400, eski kirim — 409", async () => {
    const admin = {
      Authorization: `Bearer ${(await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token}`,
    };
    const supplierToken = (
      await http().post('/api/auth/login').send({ userId: 'usr_supplier', pin: '5555' }).expect(200)
    ).body.token as string;
    const supplier = { Authorization: `Bearer ${supplierToken}` };

    await ds.manager.update(
      StockItem,
      { warehouseId: WC, ingredientId: 'ketchup' },
      { qty: 5950, minQty: 1200 },
    );
    await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: 'ketchup', qty: 3 }] },
      'usr_supplier',
      now,
    );
    await insertPending();
    // bir taomda ikki qator — 1 porsiyaga jami
    await ds.manager.update(Product, 'hotdog-classic', {
      recipe: [
        { ingredientId: 'bun-hotdog', qty: 1 },
        { ingredientId: 'ketchup', qty: 20 },
        { ingredientId: 'ketchup', qty: 5 },
      ],
    });

    const usage = (await http().get('/api/ingredients/ketchup/usage').set(admin).expect(200))
      .body as IngredientUsage;
    const products = (await ds.manager.find(Product)).filter((p) =>
      p.recipe.some((l) => l.ingredientId === 'ketchup'),
    );
    expect(usage.products).toHaveLength(products.length);
    expect(usage.products).toContainEqual({
      id: 'hotdog-classic',
      name: expect.objectContaining({ uz: 'Klassik hot-dog' }),
      qty: 25,
    });
    expect(usage.products).toContainEqual(expect.objectContaining({ id: 'burger-classic', qty: 10 }));
    const stock = (
      await ds.manager.find(StockItem, { where: { ingredientId: 'ketchup' }, order: { warehouseId: 'ASC' } })
    )
      .filter((s) => s.qty !== 0 || s.minQty > 0 || s.targetQty > 0)
      .map(({ warehouseId, qty, minQty, targetQty }) => ({ warehouseId, qty, minQty, targetQty }));
    expect(usage.stock).toEqual(stock);
    expect(usage.stock).toContainEqual({ warehouseId: WC, qty: 5950, minQty: 1200, targetQty: 0 });
    expect(usage).toMatchObject({ purchases: 2, pendingPurchases: 1, transfers: 0 });

    // mahsulot hech qayerda ishlatilmagan
    const fresh = await http()
      .post('/api/ingredients')
      .set(admin)
      .send({ name: { uz: 'Rayhon', ru: '', en: '' }, group: 'vegetables', unit: 'kg', active: true })
      .expect(201);
    expect((await http().get(`/api/ingredients/${fresh.body.id}/usage`).set(admin).expect(200)).body).toEqual(
      {
        products: [],
        stock: [],
        purchases: 0,
        pendingPurchases: 0,
        transfers: 0,
      },
    );

    await http().get('/api/ingredients/ketchup/usage').set(supplier).expect(403);
    expect((await http().get('/api/ingredients/nope/usage').set(admin).expect(404)).body.code).toBe(
      'not_found',
    );

    const body = { name: KETCHUP_NAME, group: 'sauces', active: true };
    const bad = await http()
      .patch('/api/ingredients/ketchup')
      .set(admin)
      .send({ ...body, unit: 'gram' })
      .expect(400);
    expect(bad.body.code).toBe('invalid_input');
    const pending = await http()
      .patch('/api/ingredients/ketchup')
      .set(admin)
      .send({ ...body, unit: 'pcs' })
      .expect(409);
    expect(pending.body.code).toBe('pending_purchase');
    const forbidden = await http()
      .patch('/api/ingredients/ketchup')
      .set(supplier)
      .send({ ...body, unit: 'l' })
      .expect(403);
    expect(forbidden.body.code).toBe('forbidden');
    const relabeled = await http()
      .patch('/api/ingredients/ketchup')
      .set(admin)
      .send({ ...body, unit: 'l' })
      .expect(200);
    expect(relabeled.body).toMatchObject({ unit: 'l', lastPrice: 28000 });
  });
});
