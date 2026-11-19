import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Product } from '../src/menu/product.entity';
import { orderItemCosts } from '../src/orders/item-costs';
import { loadPurchaseNotice, purchaseNoticeText } from '../src/telegram/purchase-text';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { Purchase } from '../src/warehouse/purchase.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
import { StockService } from '../src/warehouse/stock.service';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { BRANCH_CHILONZOR as C, WAREHOUSE_CENTRAL as CENTRAL } from './fixtures/demo-data';
import { createTestApp } from './test-app';

/**
 * Norma va pishganda chiqishi (2026-11-19). Foydalanuvchi o'lchagan namuna: 20 ta tovuq, 64 kg → 34,5 kg yarim tayyor
 * go'sht + 5 kg qanot (KFC uchun), 24,5 kg suyak. Normani tovuq oynasiga bir marta yozadi — keyin kirimda faqat
 * "Tovuq N kg", omborga go'sht va qanot o'zi tushadi. Yarim tayyor go'sht filialga ketadi va o'sha yerda pishadi:
 * 1000 g → 655 g; shaurma retseptida "100 g pishgan" — sotuvda 153 g yarim tayyor ayriladi.
 */

const now = new Date('2026-11-19T12:00:00');
const WC = 'wh_chilonzor';
const SUPPLIER = 'usr_supplier';
const name = (uz: string) => ({ uz, ru: uz, en: uz });

describe("norma (tovuq → go'sht + qanot) va pishganda chiqishi", () => {
  let app: INestApplication;
  let ds: DataSource;
  let warehouse: WarehouseService;
  const http = () => request(app.getHttpServer());
  let admin: { Authorization: string };
  let supplier: { Authorization: string };
  let ids: { chicken: string; meat: string; wings: string; patty: string };

  const qtyOf = async (warehouseId: string, ingredientId: string) =>
    (await ds.manager.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;
  const ingredient = (id: string) => ds.manager.findOneByOrFail(Ingredient, { id });
  /** PATCH tanasi — oynadagidek hamma maydon, ustiga [extra] */
  const body = async (id: string, extra: object) => {
    const current = await ingredient(id);
    return { name: current.name, group: current.group, unit: current.unit, active: current.active, ...extra };
  };
  const patch = async (as: { Authorization: string }, id: string, extra: object, status: number) =>
    (
      await http()
        .patch(`/api/ingredients/${id}`)
        .set(as)
        .send(await body(id, extra))
        .expect(status)
    ).body;
  const chickenNorm = () => ({
    qty: 64,
    outputs: [
      { ingredientId: ids.meat, qty: 34.5 },
      { ingredientId: ids.wings, qty: 5 },
    ],
  });
  const buyChicken = (qty: number, warehouseId = CENTRAL, price = 30000) =>
    warehouse.createPurchase(
      { warehouseId, items: [{ ingredientId: ids.chicken, qty, price }] },
      SUPPLIER,
      now,
    );

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    warehouse = app.get(WarehouseService);
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
    const save = (label: string, unit: 'kg' | 'pcs') =>
      warehouse.saveIngredient({ name: name(label), group: 'meat', unit, active: true }, 'admin');
    ids = {
      chicken: (await save('Tovuq', 'kg')).id,
      meat: (await save("Go'sht (yarim tayyor)", 'kg')).id,
      wings: (await save('Qanot', 'kg')).id,
      patty: (await save('Katlet', 'pcs')).id,
    };
    const adminToken = (
      await http()
        .post('/api/auth/admin-login')
        .send({ email: 'admin@gmail.com', password: '123456789' })
        .expect(200)
    ).body.token as string;
    admin = { Authorization: `Bearer ${adminToken}` };
    const supplierToken = (
      await http().post('/api/auth/login').send({ userId: SUPPLIER, pin: '5555' }).expect(200)
    ).body.token as string;
    supplier = { Authorization: `Bearer ${supplierToken}` };
  });

  afterAll(() => app.close());

  it("normani admin yozadi; kirimda tovuq o'zi emas — go'sht va qanot qo'shiladi, narx og'irligi bo'yicha", async () => {
    const saved = await patch(admin, ids.chicken, { yieldNorm: chickenNorm() }, 200);
    expect(saved.yieldNorm).toEqual(chickenNorm());
    expect(saved.cookYield).toBeNull();

    // 64 kg × 30 000 → go'sht 34,5 kg, qanot 5 kg; 1 kg = 30 000 × 64 ÷ 39,5 = 48 608
    const first = await buyChicken(64);
    expect(first.items).toEqual([
      {
        ingredientId: ids.chicken,
        qty: 64,
        price: 30000,
        packSize: null,
        outputs: [
          { ingredientId: ids.meat, qty: 34500 },
          { ingredientId: ids.wings, qty: 5000 },
        ],
      },
    ]);
    expect(await qtyOf(CENTRAL, ids.meat)).toBe(34500);
    expect(await qtyOf(CENTRAL, ids.wings)).toBe(5000);
    expect(
      await ds.manager.findOneBy(StockItem, { warehouseId: CENTRAL, ingredientId: ids.chicken }),
    ).toBeNull();
    expect((await ingredient(ids.chicken)).lastPrice).toBe(30000);
    expect((await ingredient(ids.meat)).lastPrice).toBe(48608);
    expect((await ingredient(ids.wings)).lastPrice).toBe(48608);
    // saqlangan hujjat ham o'sha
    expect((await ds.manager.findOneByOrFail(Purchase, { id: first.id })).items[0].outputs).toHaveLength(2);

    // harakat — go'sht va qanotga "Kirim №N", tovuqqa — yo'q
    const moves = await ds.manager.findBy(StockMovement, { refId: first.id });
    expect(moves.map((m) => [m.ingredientId, m.qty, m.kind]).sort()).toEqual(
      [
        [ids.meat, 34500, 'purchase'],
        [ids.wings, 5000, 'purchase'],
      ].sort(),
    );
    const history = await http()
      .get('/api/movements')
      .query({ ingredientId: ids.meat })
      .set(supplier)
      .expect(200);
    expect(history.body.items[0]).toMatchObject({
      kind: 'purchase',
      refNumber: first.number,
      refBy: SUPPLIER,
    });

    // keyingi kirim 70 kg, 32 000 dan (HTTP, ta'minotchi) → +37 734 g, +5 469 g
    const second = await http()
      .post('/api/purchases')
      .set(supplier)
      .send({ warehouseId: CENTRAL, items: [{ ingredientId: ids.chicken, qty: 70, price: 32000 }] })
      .expect(201);
    expect(second.body.items[0].outputs).toEqual([
      { ingredientId: ids.meat, qty: 37734 },
      { ingredientId: ids.wings, qty: 5469 },
    ]);
    expect(await qtyOf(CENTRAL, ids.meat)).toBe(34500 + 37734);
    expect(await qtyOf(CENTRAL, ids.wings)).toBe(5000 + 5469);
    expect((await ingredient(ids.meat)).lastPrice).toBe(51848); // 32 000 × 64 ÷ 39,5 = 51 848,1

    // Telegram "Yangi kirim" — omborga nima tushgani
    const text = purchaseNoticeText(await loadPurchaseNotice(ds.manager, first));
    expect(text).toContain(
      "• Tovuq — 64 kg\n   1 kg narxi: 30 000 so'm · jami: 1 920 000 so'm\n   omborga: Go'sht (yarim tayyor) 34,5 kg, Qanot 5 kg",
    );
  });

  it("filial omboriga kirim — chiqqanlari o'sha omborga; shu kirimda go'shtning o'z qatori bo'lsa — o'sha narx qoladi", async () => {
    await patch(admin, ids.chicken, { yieldNorm: chickenNorm() }, 200);
    await warehouse.createPurchase(
      {
        warehouseId: WC,
        items: [
          { ingredientId: ids.chicken, qty: 6.4, price: 30000 },
          { ingredientId: ids.meat, qty: 2, price: 60000 },
        ],
      },
      SUPPLIER,
      now,
    );
    expect(await qtyOf(WC, ids.meat)).toBe(3450 + 2000);
    expect(await qtyOf(WC, ids.wings)).toBe(500);
    expect(await qtyOf(CENTRAL, ids.meat)).toBe(0);
    expect((await ingredient(ids.meat)).lastPrice).toBe(60000);
    expect((await ingredient(ids.wings)).lastPrice).toBe(48608);
  });

  it("eski (tasdiq kutayotgan) kirim tasdiqlanganda — hozirgi norma bo'yicha", async () => {
    await patch(admin, ids.chicken, { yieldNorm: chickenNorm() }, 200);
    await ds.manager.insert(Purchase, {
      id: 'pur_old',
      number: 900,
      warehouseId: CENTRAL,
      items: [{ ingredientId: ids.chicken, qty: 32, price: null, packSize: null }],
      note: '',
      status: 'pending',
      createdBy: SUPPLIER,
      createdAt: new Date('2026-11-01T10:00:00'),
      decidedBy: null,
      decidedAt: null,
    });
    const approved = await warehouse.approvePurchase('pur_old', { [ids.chicken]: 30000 }, 'usr_admin', now);
    expect(approved.items[0].outputs).toEqual([
      { ingredientId: ids.meat, qty: 17250 },
      { ingredientId: ids.wings, qty: 2500 },
    ]);
    expect(await qtyOf(CENTRAL, ids.meat)).toBe(17250);
    expect((await ingredient(ids.meat)).lastPrice).toBe(48608);
  });

  it("norma faqat admin; xato normalar — hech narsa saqlanmaydi; chiqishni o'chirib bo'lmaydi", async () => {
    // ta'minotchi: boshqa norma — 403, o'sha normani (oyna hamma maydonni yuboradi) — mumkin
    expect((await patch(supplier, ids.chicken, { yieldNorm: chickenNorm() }, 403)).code).toBe('forbidden');
    await patch(admin, ids.chicken, { yieldNorm: chickenNorm() }, 200);
    await patch(supplier, ids.chicken, { yieldNorm: chickenNorm(), lastPrice: 31000 }, 200);
    expect((await ingredient(ids.chicken)).lastPrice).toBe(31000);
    expect((await patch(supplier, ids.chicken, { yieldNorm: null }, 403)).code).toBe('forbidden');
    // yangi mahsulot normasi bilan — ham faqat admin
    const created = await http()
      .post('/api/ingredients')
      .set(supplier)
      .send({ name: name('Tovuq 2'), group: 'meat', unit: 'kg', active: true, yieldNorm: chickenNorm() })
      .expect(403);
    expect(created.body.code).toBe('forbidden');

    const code = async (yieldNorm: object, status = 400, id = ids.chicken) =>
      (await patch(admin, id, { yieldNorm }, status)).code as string;
    const out = (ingredientId: string, qty: number) => ({ ingredientId, qty });
    expect(await code({ qty: 0, outputs: [out(ids.meat, 1)] })).toBe('invalid_qty');
    expect(await code({ qty: 64, outputs: [] })).toBe('invalid_input');
    expect(await code({ qty: 64, outputs: [out(ids.meat, 1), out(ids.meat, 2)] })).toBe('invalid_input');
    expect(await code({ qty: 64, outputs: [out(ids.chicken, 1)] })).toBe('invalid_input');
    // donadagi mahsulot — boshqa o'lcham
    expect(await code({ qty: 64, outputs: [out(ids.patty, 10)] })).toBe('invalid_input');
    expect(await code({ qty: 64, outputs: [out(ids.meat, 0)] })).toBe('invalid_qty');
    // chiqqanlar namunadan ko'p
    expect(await code({ qty: 64, outputs: [out(ids.meat, 60), out(ids.wings, 5)] })).toBe('invalid_qty');
    expect(await code({ qty: 64, outputs: [out('nope', 1)] }, 404)).toBe('not_found');
    expect(await code({ qty: 64, outputs: 'x' })).toBe('invalid_input');
    // zanjir: go'shtga norma (tovuq normasida chiqish) va chiqishi normali mahsulot
    expect(await code({ qty: 10, outputs: [out(ids.wings, 1)] }, 400, ids.meat)).toBe('invalid_input');
    const other = (
      await warehouse.saveIngredient(
        { name: name('Tovuq 3'), group: 'meat', unit: 'kg', active: true },
        'admin',
      )
    ).id;
    expect(await code({ qty: 10, outputs: [out(ids.chicken, 1)] }, 400, other)).toBe('invalid_input');
    expect((await ingredient(ids.chicken)).yieldNorm).toEqual(chickenNorm());

    // normadagi chiqish: o'chirib bo'lmaydi, donaga o'tkazib bo'lmaydi
    const removed = await http().delete(`/api/ingredients/${ids.wings}`).set(admin).expect(409);
    expect(removed.body).toMatchObject({ code: 'in_use', detail: 'norms' });
    expect((await patch(admin, ids.wings, { unit: 'pcs' }, 400)).code).toBe('invalid_input');
    // tovuqning o'zi donaga o'tsa — norma o'chadi; kg ↔ l — qoladi
    await patch(admin, ids.chicken, { unit: 'l' }, 200);
    expect((await ingredient(ids.chicken)).yieldNorm).toEqual(chickenNorm());
    await patch(admin, ids.chicken, { unit: 'pcs' }, 200);
    expect((await ingredient(ids.chicken)).yieldNorm).toBeNull();
    // norma o'chgach — go'shtni o'chirsa bo'ladi (ishlatilmagan)
    await http().delete(`/api/ingredients/${ids.wings}`).set(admin).expect(204);
  });

  it('pishganda chiqishi: shaurmada 100 g pishgan → filialdan 153 g; tannarx ham shundan; bekor qilinsa aynan qaytadi', async () => {
    // faqat admin, faqat kg / l, 1…10 000
    expect((await patch(supplier, ids.meat, { cookYield: 655 }, 403)).code).toBe('forbidden');
    expect((await patch(admin, ids.patty, { cookYield: 655 }, 400)).code).toBe('invalid_input');
    expect((await patch(admin, ids.meat, { cookYield: 0 }, 400)).code).toBe('invalid_qty');
    expect((await patch(admin, ids.meat, { cookYield: 65.5 }, 400)).code).toBe('invalid_qty');
    expect((await patch(admin, ids.meat, { cookYield: 655 }, 200)).cookYield).toBe(655);
    // ta'minotchi o'sha qiymat bilan saqlay oladi
    await patch(supplier, ids.meat, { cookYield: 655, lastPrice: 48608 }, 200);

    // markazdan filialga 10 kg yarim tayyor go'sht
    await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: ids.meat, qty: 10, price: 48608 }] },
      SUPPLIER,
      now,
    );
    await warehouse.createTransfer(
      { fromWarehouseId: CENTRAL, toWarehouseId: WC, items: [{ ingredientId: ids.meat, qty: 10 }] },
      SUPPLIER,
      now,
    );
    await ds.manager.update(Product, 'burger-classic', { recipe: [{ ingredientId: ids.meat, qty: 100 }] });

    const stock = app.get(StockService);
    await ds.transaction((em) =>
      stock.deductOrder(
        em,
        { id: 'ord_shaurma', branchId: C, items: [{ productId: 'burger-classic', qty: 2 }] },
        now,
      ),
    );
    // 1 porsiya — 153 g (152,67), 2 ta — 306 g
    expect(await qtyOf(WC, ids.meat)).toBe(10000 - 306);
    // tannarx: 153 × 48 608 / 1000 = 7 437
    expect(await orderItemCosts(ds.manager, [{ productId: 'burger-classic' }])).toEqual([7437]);

    await ds.transaction((em) => stock.returnOrder(em, 'ord_shaurma', now));
    expect(await qtyOf(WC, ids.meat)).toBe(10000);

    // pishish o'chirilsa — retseptdagi son o'zi
    await patch(admin, ids.meat, { cookYield: null }, 200);
    await ds.transaction((em) =>
      stock.deductOrder(
        em,
        { id: 'ord_raw', branchId: C, items: [{ productId: 'burger-classic', qty: 1 }] },
        now,
      ),
    );
    expect(await qtyOf(WC, ids.meat)).toBe(9900);
  });
});
