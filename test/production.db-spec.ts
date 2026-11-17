import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Product } from '../src/menu/product.entity';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { LowStockEvents, type LowStockCrossing } from '../src/warehouse/low-stock-events';
import { Production } from '../src/warehouse/production.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
import { StockService } from '../src/warehouse/stock.service';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { BRANCH_CHILONZOR as C, WAREHOUSE_CENTRAL as CENTRAL } from './fixtures/demo-data';
import { createTestApp } from './test-app';

/**
 * Tayyorlash (2026-11-18): markaziy omborga 50 kg go'sht va 5 qadoq tuxum (30 talik) keladi; oshpaz katlet yasab,
 * qancha go'sht, tuxum, yog' sarflaganini aytadi, ta'minotchi chiqqan katlet sonini yozadi — sarflanganlar ayriladi,
 * katlet qo'shiladi ("Tayyorlash №N"). Miqdorlar qadoqsiz (tuxum — donada). Burgerda katlet 1 dona ayriladi.
 */

const now = new Date('2026-11-18T12:00:00');
const WC = 'wh_chilonzor';
const SUPPLIER = 'usr_supplier';
const name = (uz: string) => ({ uz, ru: uz, en: uz });

describe('tayyorlash (go\'sht + tuxum + yog\' → katlet)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let warehouse: WarehouseService;
  const http = () => request(app.getHttpServer());
  const crossings: LowStockCrossing[] = [];
  let supplier: { Authorization: string };
  let ids: { meat: string; egg: string; oil: string; patty: string };

  const qtyOf = async (warehouseId: string, ingredientId: string) =>
    (await ds.manager.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;
  const centralQty = async () => ({
    meat: await qtyOf(CENTRAL, ids.meat),
    egg: await qtyOf(CENTRAL, ids.egg),
    oil: await qtyOf(CENTRAL, ids.oil),
    patty: await qtyOf(CENTRAL, ids.patty),
  });
  const produce = (body: object) => http().post('/api/productions').set(supplier).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    warehouse = app.get(WarehouseService);
    app.get(LowStockEvents).onLow((list) => crossings.push(...list));
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
    crossings.length = 0;
    const save = (label: string, unit: 'kg' | 'l' | 'pcs', packSize: number | null = null) =>
      warehouse.saveIngredient({ name: name(label), group: 'meat', unit, packSize, active: true }, 'supplier');
    ids = {
      meat: (await save("Go'sht", 'kg')).id,
      egg: (await save('Tuxum', 'pcs', 30)).id,
      oil: (await save("Yog'", 'l')).id,
      patty: (await save('Katlet', 'pcs')).id,
    };
    // kirim: 50 kg go'sht, 5 qadoq tuxum (150 dona), 5 l yog'
    await warehouse.createPurchase(
      {
        warehouseId: CENTRAL,
        items: [
          { ingredientId: ids.meat, qty: 50, price: 90000 },
          { ingredientId: ids.egg, qty: 5, price: 45000 },
          { ingredientId: ids.oil, qty: 5, price: 30000 },
        ],
      },
      SUPPLIER,
      // HTTP orqali tayyorlash haqiqiy vaqtda yoziladi — kirim undan oldin bo'lsin (tarix tartibi)
      new Date('2026-01-01T09:00:00'),
    );
    const token = (await http().post('/api/auth/login').send({ userId: SUPPLIER, pin: '5555' }).expect(200)).body
      .token as string;
    supplier = { Authorization: `Bearer ${token}` };
  });

  afterAll(() => app.close());

  it("sarflanganlar ayriladi, katlet qo'shiladi; tannarx va katlet narxi; harakatlar \"Tayyorlash №1\"; burgerda 1 dona", async () => {
    expect(await centralQty()).toEqual({ meat: 50000, egg: 150, oil: 5000, patty: 0 });

    const res = await produce({
      ingredientId: ids.patty,
      qty: 498,
      items: [
        { ingredientId: ids.meat, qty: 48 },
        { ingredientId: ids.egg, qty: 20 },
        { ingredientId: ids.oil, qty: 1 },
      ],
      note: '  1-partiya ',
    }).expect(201);
    expect(res.body).toMatchObject({
      number: 1,
      warehouseId: CENTRAL,
      ingredientId: ids.patty,
      qty: 498,
      items: [
        { ingredientId: ids.meat, qty: 48 },
        { ingredientId: ids.egg, qty: 20 },
        { ingredientId: ids.oil, qty: 1 },
      ],
      cost: 4_380_000, // 48 × 90 000 + 20 × 45 000 / 30 + 1 × 30 000
      note: '1-partiya',
      createdBy: SUPPLIER,
    });

    // go'sht 50 → 2 kg, tuxum 150 → 130 dona ("4 qadoq + 10 dona"), yog' 5 → 4 l, katlet 0 → 498
    expect(await centralQty()).toEqual({ meat: 2000, egg: 130, oil: 4000, patty: 498 });
    expect((await ds.manager.findOneByOrFail(Ingredient, { id: ids.patty })).lastPrice).toBe(8795);
    // sarflanganlarning narxi o'zgarmaydi
    expect((await ds.manager.findOneByOrFail(Ingredient, { id: ids.egg })).lastPrice).toBe(45000);

    const history = async (ingredientId: string) =>
      (await http().get('/api/movements').query({ warehouseId: CENTRAL, ingredientId }).set(supplier).expect(200)).body
        .items[0];
    expect(await history(ids.meat)).toMatchObject({
      kind: 'production',
      qty: -48000,
      refId: res.body.id,
      refNumber: 1,
      refWarehouseId: null,
      refBy: SUPPLIER,
    });
    expect(await history(ids.patty)).toMatchObject({ kind: 'production', qty: 498, refNumber: 1, refBy: SUPPLIER });
    const byKind = await http().get('/api/movements').query({ kind: 'production' }).set(supplier).expect(200);
    expect(byKind.body.total).toBe(4);

    // ro'yxat: tayyor mahsulot bo'yicha (sarflanganlar bo'yicha emas)
    const list = await http().get('/api/productions').query({ ingredientId: ids.patty }).set(supplier).expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ id: res.body.id, number: 1 }] });
    expect(
      (await http().get('/api/productions').query({ ingredientId: ids.meat }).set(supplier).expect(200)).body.total,
    ).toBe(0);

    // filialga 100 dona → 3 ta burger sotildi (retseptda katlet 1 dona) → 97
    await warehouse.createTransfer(
      { fromWarehouseId: CENTRAL, toWarehouseId: WC, items: [{ ingredientId: ids.patty, qty: 100 }] },
      SUPPLIER,
      now,
    );
    await ds.manager.update(Product, 'burger-classic', { recipe: [{ ingredientId: ids.patty, qty: 1 }] });
    await ds.transaction((em) =>
      app
        .get(StockService)
        .deductOrder(em, { id: 'ord_patty', branchId: C, items: [{ productId: 'burger-classic', qty: 3 }] }, now),
    );
    expect(await qtyOf(WC, ids.patty)).toBe(97);
    expect(await qtyOf(CENTRAL, ids.patty)).toBe(398);

    // ikkinchi tayyorlash — №2
    const second = await produce({
      ingredientId: ids.patty,
      qty: 20,
      items: [{ ingredientId: ids.meat, qty: 2 }],
    }).expect(201);
    expect(second.body.number).toBe(2);
    expect(await centralQty()).toMatchObject({ meat: 0, patty: 418 });
  });

  it("xatolar: bo'sh, miqdor, katlet o'zi sarflanganda, noma'lum mahsulot, qoldiq yetmasa (ikki qatorda ham) — hech narsa o'zgarmaydi", async () => {
    const before = await centralQty();
    const code = async (body: object, status: number) => (await produce(body).expect(status)).body.code as string;
    const meat = (qty: number) => ({ ingredientId: ids.meat, qty });

    expect(await code({ ingredientId: ids.patty, qty: 10, items: [] }, 400)).toBe('empty_order');
    expect(await code({ ingredientId: ids.patty, qty: 0, items: [meat(1)] }, 400)).toBe('invalid_qty');
    expect(await code({ ingredientId: ids.patty, qty: 10, items: [meat(-1)] }, 400)).toBe('invalid_qty');
    // 0,0001 kg → 0 g
    expect(await code({ ingredientId: ids.patty, qty: 10, items: [meat(0.0001)] }, 400)).toBe('invalid_qty');
    expect(
      await code({ ingredientId: ids.patty, qty: 10, items: [meat(1), { ingredientId: ids.patty, qty: 1 }] }, 400),
    ).toBe('invalid_input');
    expect(await code({ ingredientId: 'nope', qty: 10, items: [meat(1)] }, 404)).toBe('not_found');
    expect(await code({ ingredientId: ids.patty, qty: 10, items: [{ ingredientId: 'nope', qty: 1 }] }, 404)).toBe(
      'not_found',
    );
    expect(await code({ ingredientId: ids.patty, qty: 10, items: [meat(51)] }, 409)).toBe('insufficient_stock');
    // bir mahsulot ikki qatorda: 30 + 25 > 50
    expect(await code({ ingredientId: ids.patty, qty: 10, items: [meat(30), meat(25)] }, 409)).toBe(
      'insufficient_stock',
    );
    expect(await code({ ingredientId: ids.patty, qty: 10, items: 'x' }, 400)).toBe('invalid_input');

    expect(await centralQty()).toEqual(before);
    expect(await ds.manager.count(Production)).toBe(0);
    expect(await ds.manager.countBy(StockMovement, { kind: 'production' })).toBe(0);
    // raqam ham sarflanmagan
    expect((await produce({ ingredientId: ids.patty, qty: 10, items: [meat(1)] }).expect(201)).body.number).toBe(1);
  });

  it('kassir kira olmaydi, admin ham yozadi', async () => {
    const cashierToken = (
      await http().post('/api/auth/login').send({ userId: 'usr_cashier_c1', pin: '1234', branchId: C }).expect(200)
    ).body.token as string;
    const cashier = { Authorization: `Bearer ${cashierToken}` };
    const body = { ingredientId: ids.patty, qty: 10, items: [{ ingredientId: ids.meat, qty: 1 }] };
    await http().post('/api/productions').set(cashier).send(body).expect(403);
    await http().get('/api/productions').set(cashier).expect(403);

    const adminToken = (
      await http().post('/api/auth/admin-login').send({ email: 'admin@gmail.com', password: '123456789' }).expect(200)
    ).body.token as string;
    const created = await http()
      .post('/api/productions')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send(body)
      .expect(201);
    expect(created.body.createdBy).toBe('usr_admin');
  });

  it("narxsiz sarflangan — tannarx noma'lum, katlet narxi o'zgarmaydi", async () => {
    await ds.manager.update(Ingredient, ids.oil, { lastPrice: null });
    await ds.manager.update(Ingredient, ids.patty, { lastPrice: 7000 });
    const res = await produce({
      ingredientId: ids.patty,
      qty: 100,
      items: [
        { ingredientId: ids.meat, qty: 10 },
        { ingredientId: ids.oil, qty: 0.5 },
      ],
    }).expect(201);
    expect(res.body.cost).toBeNull();
    expect((await ds.manager.findOneByOrFail(Ingredient, { id: ids.patty })).lastPrice).toBe(7000);
    expect(await centralQty()).toMatchObject({ meat: 40000, oil: 4500, patty: 100 });
  });

  it("chegaradan tushgan sarflangan — \"kam qoldi\" hodisasi; o'chirish — in_use; birlik ogohlantirishida soni", async () => {
    await warehouse.setMinQty(CENTRAL, ids.meat, 5000);
    await produce({ ingredientId: ids.patty, qty: 480, items: [{ ingredientId: ids.meat, qty: 48 }] }).expect(201);
    // hodisa yoziladi (Telegram matni esa faqat filial omborlarini oladi — markaz uchun xabar ketmaydi)
    expect(crossings).toEqual([{ warehouseId: CENTRAL, ingredientId: ids.meat }]);

    const remove = async (id: string) =>
      (await http().delete(`/api/ingredients/${id}`).set(supplier).expect(409)).body;
    // katletning kirimi ham, ko'chirishi ham yo'q — faqat tayyorlashda
    expect(await remove(ids.patty)).toMatchObject({ code: 'in_use', detail: 'productions' });

    expect((await warehouse.ingredientUsage(ids.patty)).productions).toBe(1);
    expect((await warehouse.ingredientUsage(ids.meat)).productions).toBe(1);
    expect((await warehouse.ingredientUsage(ids.egg)).productions).toBe(0);
  });
});
