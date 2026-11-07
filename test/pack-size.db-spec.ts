import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AiTools } from '../src/ai/ai.tools';
import { splitPacks } from '../src/domain/units';
import { Product } from '../src/menu/product.entity';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { Purchase } from '../src/warehouse/purchase.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockService } from '../src/warehouse/stock.service';
import { Transfer } from '../src/warehouse/transfer.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C, WAREHOUSE_CENTRAL as CENTRAL } from './fixtures/demo-data';
import { createTestApp, expectCode } from './test-app';

/**
 * Qadoq (2026-11-04): ketchup 600 g lik shishada keladi — kirim va ko'chirish donada ("Ketchup — 10"), retseptda
 * grammda (hot-dog — 50 g), qoldiq grammda saqlanadi va "9 dona + 550 g" bo'lib ko'rinadi. Narx — 1 dona uchun.
 */

const now = new Date('2026-11-04T12:00:00');
const WC = 'wh_chilonzor';
const MIGRATION = 'IngredientPackSize1793790000000';
const KETCHUP_NAME = { uz: 'Ketchup', ru: 'Кетчуп', en: 'Ketchup' };

describe('ombor mahsuloti qadog\'i (1 dona = 600 g)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let warehouse: WarehouseService;
  const http = () => request(app.getHttpServer());

  const stockQty = async (warehouseId: string, ingredientId: string) =>
    (await ds.manager.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;
  const ketchup = () => ds.manager.findOneByOrFail(Ingredient, { id: 'ketchup' });
  const saveKetchup = (patch: { packSize?: number | null; lastPrice?: number | null }, role: 'admin' | 'supplier') =>
    warehouse.saveIngredient({ id: 'ketchup', name: KETCHUP_NAME, group: 'sauces', active: true, ...patch }, role);
  /** filialda [count] ta hot-dog sotildi (retsept bo'yicha ayirish — buyurtma "oshxonaga ketdi") */
  const sellHotdogs = (count: number) =>
    ds.transaction((em) =>
      app.get(StockService).deductOrder(em, { id: `ord_t${count}`, branchId: C, items: [{ productId: 'hotdog-classic', qty: count }] }, now),
    );

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    warehouse = app.get(WarehouseService);
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
    // hot-dog: non, sosiska, 50 g ketchup
    await ds.manager.update(Product, 'hotdog-classic', {
      recipe: [
        { ingredientId: 'bun-hotdog', qty: 1 },
        { ingredientId: 'sausage', qty: 1 },
        { ingredientId: 'ketchup', qty: 50 },
      ],
    });
  });

  afterAll(() => app.close());

  it('kirim va ko\'chirish donada, sotuv grammdan; qoldiq — to\'liq dona + ochilgani', async () => {
    // ta'minotchi qadoq hajmini qo'ydi: narx (28 000 / kg) o'zi 1 dona narxiga o'giriladi
    const saved = await saveKetchup({ packSize: 600 }, 'supplier');
    expect(saved).toMatchObject({ unit: 'kg', packSize: 600, lastPrice: 16800 });

    // ta'minotchi kirimda 1 dona narxini yozadi — darhol omborga, oxirgi narx shunga
    const central0 = await stockQty(CENTRAL, 'ketchup');
    const purchase = await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: 'ketchup', qty: 10, price: 17000 }] },
      'usr_supplier',
      now,
    );
    expect(purchase.items).toEqual([{ ingredientId: 'ketchup', qty: 10, price: 17000, packSize: 600 }]);
    expect(await stockQty(CENTRAL, 'ketchup')).toBe(central0 + 6000);
    expect((await ketchup()).lastPrice).toBe(17000);

    // filialga 3 dona
    const branch0 = await stockQty(WC, 'ketchup'); // demo: 12 kg
    const transfer = await warehouse.createTransfer(
      { fromWarehouseId: CENTRAL, toWarehouseId: WC, items: [{ ingredientId: 'ketchup', qty: 3 }] },
      'usr_supplier',
      now,
    );
    expect(transfer.items).toEqual([{ ingredientId: 'ketchup', qty: 3, packSize: 600 }]);
    expect(await stockQty(WC, 'ketchup')).toBe(branch0 + 1800);
    expect(await stockQty(CENTRAL, 'ketchup')).toBe(central0 + 6000 - 1800);
    expect(splitPacks(branch0 + 1800, 600)).toEqual({ packs: 23, rest: 0 });

    // 1 ta hot-dog — 50 g: 22 dona + 550 g; yana 11 ta (jami 600 g) — 22 dona
    await sellHotdogs(1);
    expect(splitPacks(await stockQty(WC, 'ketchup'), 600)).toEqual({ packs: 22, rest: 550 });
    await sellHotdogs(11);
    expect(splitPacks(await stockQty(WC, 'ketchup'), 600)).toEqual({ packs: 22, rest: 0 });

    // qoldiqdan ko'p dona ko'chirib bo'lmaydi (qoldiq — 13 200 g = 22 dona)
    await expectCode('insufficient_stock', () =>
      warehouse.createTransfer(
        { fromWarehouseId: WC, toWarehouseId: CENTRAL, items: [{ ingredientId: 'ketchup', qty: 23 }] },
        'usr_supplier',
        now,
      ),
    );
  });

  it("qadoq hajmi o'zgarsa: eski kutayotgan kirim o'z hajmi bilan, narx — yangi birlikka", async () => {
    await saveKetchup({ packSize: 600, lastPrice: 18000 }, 'admin');
    // 2026-11-08 gacha yozilgan, tasdiq kutayotgan kirim: 600 g lik 5 dona
    await ds.manager.insert(Purchase, {
      id: 'pur_legacy',
      number: 900,
      warehouseId: CENTRAL,
      items: [{ ingredientId: 'ketchup', qty: 5, price: 18000, packSize: 600 }],
      note: '',
      status: 'pending',
      createdBy: 'usr_supplier',
      createdAt: now,
      decidedBy: null,
      decidedAt: null,
    });

    // endi 500 g lik shisha: narx yuborilmadi — 18 000 / 600 g → 15 000 / 500 g
    expect(await saveKetchup({ packSize: 500 }, 'admin')).toMatchObject({ packSize: 500, lastPrice: 15000 });
    // qadoq hajmi yuborilmasa — o'zgarmaydi
    expect(await saveKetchup({}, 'supplier')).toMatchObject({ packSize: 500, lastPrice: 15000 });

    // kirim 600 g lik 5 dona edi: qoldiqqa 3000 g; 1 dona (600 g) narxi 18 600 → oxirgi narx 500 g uchun 15 500
    const central0 = await stockQty(CENTRAL, 'ketchup');
    await warehouse.approvePurchase('pur_legacy', { ketchup: 18600 }, 'usr_admin', now);
    expect(await stockQty(CENTRAL, 'ketchup')).toBe(central0 + 3000);
    expect((await ketchup()).lastPrice).toBe(15500);

    // qadoqsiz (kg): ta'minotchi — narx o'zi 1 kg ga (15 500 / 500 g → 31 000 / kg); admin yuborgani — o'zgarishsiz
    expect(await saveKetchup({ packSize: null }, 'supplier')).toMatchObject({ packSize: null, lastPrice: 31000 });
    await saveKetchup({ packSize: 1000 }, 'supplier');
    expect(await saveKetchup({ packSize: null, lastPrice: 29000 }, 'admin')).toMatchObject({
      packSize: null,
      lastPrice: 29000,
    });
  });

  it("qadoq hajmi — butun 1…1 000 000; ta'minotchi narx yubora olmaydi; HTTP javobida packSize", async () => {
    for (const packSize of [0, -600, 0.5, 1_000_001]) {
      await expectCode('invalid_qty', () => saveKetchup({ packSize }, 'admin'));
    }
    await expectCode('forbidden', () => saveKetchup({ packSize: 600, lastPrice: 16800 }, 'supplier'));
    expect((await ketchup()).packSize).toBeNull();

    const token = (await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token as string;
    const auth = { Authorization: `Bearer ${token}` };
    const created = await http()
      .post('/api/ingredients')
      .set(auth)
      .send({ name: { uz: 'Mayonez 1 kg', ru: '', en: '' }, group: 'sauces', unit: 'kg', packSize: 1000, active: true })
      .expect(201);
    expect(created.body).toMatchObject({ unit: 'kg', packSize: 1000, lastPrice: null });
    const plain = await http()
      .post('/api/ingredients')
      .set(auth)
      .send({ name: { uz: 'Rayhon', ru: '', en: '' }, group: 'vegetables', unit: 'kg', active: true })
      .expect(201);
    expect(plain.body.packSize).toBeNull();
    const bad = await http()
      .patch('/api/ingredients/ketchup')
      .set(auth)
      .send({ name: KETCHUP_NAME, group: 'sauces', active: true, packSize: '600' })
      .expect(400);
    expect(bad.body.code).toBe('invalid_input');
    const list = (await http().get('/api/ingredients').set(auth).expect(200)).body as Ingredient[];
    expect(list.find((i) => i.id === 'ketchup')?.packSize).toBeNull();
  });

  it('AI: qoldiq donada va "9 dona + 550 g"; kirim — qatordagi hajm bilan', async () => {
    await saveKetchup({ packSize: 600 }, 'admin');
    await ds.manager.update(StockItem, { warehouseId: WC, ingredientId: 'ketchup' }, { qty: 5950, minQty: 1200 });
    // narx yozilmadi — oxirgi narx (28 000 / kg → 16 800 / dona)
    await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: 'ketchup', qty: 10 }] },
      'usr_supplier',
      now,
    );

    const tools = app.get(AiTools);
    const stock = (await tools.run('stock', { warehouseId: WC, search: 'ketchup' })) as { output: { items: unknown[] } };
    expect(stock.output.items).toEqual([
      expect.objectContaining({ qty: 9.917, unit: 'dona (600 g)', breakdown: '9 dona + 550 g', min: 2, status: 'ok' }),
    ]);
    const plain = (await tools.run('stock', { warehouseId: WC, search: 'mayonez' })) as { output: { items: object[] } };
    expect(plain.output.items[0]).toMatchObject({ unit: 'kg' });
    expect(plain.output.items[0]).not.toHaveProperty('breakdown');

    const today = '2026-11-04';
    const purchases = (await tools.run('purchases', { from: today, to: today })) as {
      output: { spendingByIngredient: unknown[]; latest: { items: unknown[] }[] };
    };
    expect(purchases.output.spendingByIngredient).toContainEqual({
      name: 'Ketchup',
      qty: 10,
      unit: 'dona (600 g)',
      amount: 168000,
    });
    expect(purchases.output.latest[0].items).toEqual([
      { name: 'Ketchup', qty: 10, unit: 'dona (600 g)', price: 16800 },
    ]);
  });

  it("migratsiya: ustun qo'shiladi, eski kirim / ko'chirish qatorlariga packSize: null", async () => {
    // qadoq paydo bo'lishidan oldingi hujjatlar
    await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: 'ketchup', qty: 2.5 }, { ingredientId: 'napkin', qty: 100 }] },
      'usr_supplier',
      now,
    );
    await warehouse.createTransfer(
      { fromWarehouseId: CENTRAL, toWarehouseId: WC, items: [{ ingredientId: 'ketchup', qty: 1 }] },
      'usr_supplier',
      now,
    );
    await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: 'mayo', qty: 3 }] },
      'usr_supplier',
      now,
    );
    for (;;) {
      const [last] = (await ds.query(`SELECT name FROM migrations ORDER BY id DESC LIMIT 1`)) as { name: string }[];
      await ds.undoLastMigration();
      if (last.name === MIGRATION) break;
    }
    const [{ items }] = (await ds.query(`SELECT items FROM purchases LIMIT 1`)) as { items: object[] }[];
    expect(items[0]).not.toHaveProperty('packSize');
    const columns = (await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ingredients'`,
    )) as { column_name: string }[];
    expect(columns.map((c) => c.column_name)).not.toContain('packSize');

    await ds.runMigrations();
    const purchases = await ds.manager.find(Purchase, { order: { number: 'ASC' } });
    expect(purchases.map((p) => p.items)).toEqual([
      [
        { ingredientId: 'ketchup', qty: 2.5, price: 28000, packSize: null },
        { ingredientId: 'napkin', qty: 100, price: 50, packSize: null },
      ],
      [{ ingredientId: 'mayo', qty: 3, price: 30000, packSize: null }],
    ]);
    const transfers = await ds.manager.find(Transfer);
    expect(transfers.map((t) => t.items)).toEqual([[{ ingredientId: 'ketchup', qty: 1, packSize: null }]]);
    expect((await ketchup()).packSize).toBeNull();
  });
});
