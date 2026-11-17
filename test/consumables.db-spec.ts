import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Branch } from '../src/branches/branch.entity';
import { ReportsService } from '../src/reports/reports.service';
import { loadBranchLowStock } from '../src/telegram/low-stock';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import {
  ADMIN_LOGIN,
  BRANCH_CHILONZOR as C,
  BRANCH_YUNUSOBOD as Y,
  WAREHOUSE_CENTRAL as CENTRAL,
} from './fixtures/demo-data';
import { createTestApp } from './test-app';

/**
 * Sarf materiali (2026-11-18): foydalanuvchi — "salfetka, xo'jalik buyumlari, idish yuvadigan suyuqlik, gubka —
 * kamayishini yangi kirim bo'lsa avvalgisi 0 bo'lib ketishi bilan boshqarish kerak". Tovar oynasida switch; yangi partiya
 * kelganda (kirim — o'sha omborda, ko'chirish — qabul qilgan omborda) eski qoldiq "Sarflandi" (`consume`), qiymati —
 * eski narxda; "kam qoldi" ga kirmaydi; hisobot — "Xo'jalik sarflari" (Luchvoy kabi markazdan sotadigan filial —
 * markaziy ombor sarfi).
 */

const WC = 'wh_chilonzor';
const SUPPLIER = 'usr_supplier';
const name = (uz: string) => ({ uz, ru: uz, en: uz });
const at = (day: number, hour = 10) => new Date(`2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`);

describe('sarf materiali: yangi partiya kelganda eski qoldiq "Sarflandi"', () => {
  let app: INestApplication;
  let ds: DataSource;
  let warehouse: WarehouseService;
  let reports: ReportsService;
  let ids: { napkin: string; sponge: string; bun: string };
  const http = () => request(app.getHttpServer());

  const qtyOf = async (warehouseId: string, ingredientId: string) =>
    (await ds.manager.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;
  const consumed = (warehouseId: string, ingredientId: string) =>
    ds.manager.find(StockMovement, {
      where: { warehouseId, ingredientId, kind: 'consume' },
      order: { createdAt: 'ASC' },
    });
  const buy = (warehouseId: string, items: { ingredientId: string; qty: number; price?: number }[], now: Date) =>
    warehouse.createPurchase({ warehouseId, items }, SUPPLIER, now);
  const send = (toWarehouseId: string, items: { ingredientId: string; qty: number }[], now: Date) =>
    warehouse.createTransfer({ fromWarehouseId: CENTRAL, toWarehouseId, items }, SUPPLIER, now);

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    warehouse = app.get(WarehouseService);
    reports = app.get(ReportsService);
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, at(1));
    const save = (label: string, unit: 'kg' | 'l' | 'pcs', extra: Partial<Ingredient>) =>
      warehouse.saveIngredient(
        { name: name(label), group: 'cleaning', unit, packSize: null, active: true, ...extra },
        'supplier',
      );
    ids = {
      // pachkada 100 dona, pachkasi 4 500
      napkin: (await save('Salfetka', 'pcs', { packSize: 100, lastPrice: 4500, consumable: true })).id,
      // narxi yozilmagan
      sponge: (await save('Gubka', 'pcs', { consumable: true })).id,
      bun: (await save('Non', 'pcs', { lastPrice: 2000 })).id,
    };
  });

  afterAll(() => app.close());

  it("markaziy omborga yangi kirim: eski qoldiq — Sarflandi (eski narxda), keyin yangisi; oddiy mahsulot qo'shiladi", async () => {
    await buy(CENTRAL, [{ ingredientId: ids.napkin, qty: 10 }, { ingredientId: ids.bun, qty: 50 }], at(2));
    const second = await buy(
      CENTRAL,
      [
        { ingredientId: ids.napkin, qty: 8, price: 5000 },
        { ingredientId: ids.bun, qty: 20 },
      ],
      at(9),
    );

    expect(await qtyOf(CENTRAL, ids.napkin)).toBe(800);
    expect(await consumed(CENTRAL, ids.napkin)).toMatchObject([
      // 10 pachka × 4 500 — yangi narx (5 000) yozilishidan oldingi narxda
      { qty: -1000, refId: second.id, cost: 45000, createdAt: at(9) },
    ]);
    expect((await ds.manager.findOneByOrFail(Ingredient, { id: ids.napkin })).lastPrice).toBe(5000);
    // sarf materiali emas — qo'shiladi
    expect(await qtyOf(CENTRAL, ids.bun)).toBe(70);
    expect(await consumed(CENTRAL, ids.bun)).toEqual([]);
  });

  it("ko'chirish: qabul qilgan filialda eski qoldiq Sarflandi, jo'natgan markazda — oddiy chiqim", async () => {
    await buy(CENTRAL, [{ ingredientId: ids.napkin, qty: 10 }], at(2));
    await send(WC, [{ ingredientId: ids.napkin, qty: 3 }], at(3));
    // filialda avval 0 edi — sarf yo'q
    expect(await consumed(WC, ids.napkin)).toEqual([]);
    const next = await send(WC, [{ ingredientId: ids.napkin, qty: 2 }], at(10));

    expect(await consumed(WC, ids.napkin)).toMatchObject([{ qty: -300, refId: next.id, cost: 13500 }]);
    expect(await qtyOf(WC, ids.napkin)).toBe(200);
    expect(await qtyOf(CENTRAL, ids.napkin)).toBe(500);
    expect(await consumed(CENTRAL, ids.napkin)).toEqual([]);
  });

  it("qoldiq 0 yoki minus — tegilmaydi; switch o'chiq — oddiy kirim; switch qoldiqqa darhol tegmaydi", async () => {
    // minus (masalan, retseptda ham bor edi) — tegilmaydi, yangi partiya qo'shiladi
    await ds.manager.insert(StockItem, { warehouseId: CENTRAL, ingredientId: ids.napkin, qty: -50, minQty: 0 });
    await buy(CENTRAL, [{ ingredientId: ids.napkin, qty: 1 }], at(3));
    expect(await qtyOf(CENTRAL, ids.napkin)).toBe(50);
    expect(await consumed(CENTRAL, ids.napkin)).toEqual([]);

    // switch o'chirildi — qoldiq o'zgarmadi; keyingi kirim — oddiy qo'shiladi
    const napkin = await ds.manager.findOneByOrFail(Ingredient, { id: ids.napkin });
    await warehouse.saveIngredient({ ...napkin, id: napkin.id, consumable: false }, 'supplier');
    expect(await qtyOf(CENTRAL, ids.napkin)).toBe(50);
    await buy(CENTRAL, [{ ingredientId: ids.napkin, qty: 1 }], at(4));
    expect(await qtyOf(CENTRAL, ids.napkin)).toBe(150);
    expect(await consumed(CENTRAL, ids.napkin)).toEqual([]);

    // `consumable` yuborilmasa — o'zgarmaydi
    await warehouse.saveIngredient({ name: napkin.name, group: napkin.group, active: true, id: napkin.id }, 'supplier');
    expect((await ds.manager.findOneByOrFail(Ingredient, { id: ids.napkin })).consumable).toBe(false);
  });

  it('"kam qoldi" ga kirmaydi: GET /stock/low, bosh sahifa soni, Telegram (smena hisoboti va darhol xabar)', async () => {
    await buy(CENTRAL, [{ ingredientId: ids.napkin, qty: 10 }], at(2));
    await send(WC, [{ ingredientId: ids.napkin, qty: 1 }], at(3));
    await warehouse.setMinQty(WC, ids.napkin, 500);
    const lowIds = async () => (await warehouse.lowStock(WC)).map((s) => s.ingredientId);
    const telegramNames = async () => (await loadBranchLowStock(ds.manager, C)).map((line) => line.name);

    expect(await lowIds()).not.toContain(ids.napkin);
    expect(await telegramNames()).not.toContain('Salfetka');
    const overview = (await reports.overview()).lowStock;

    // switch o'chsa — oddiy mahsulotdek "kam qoldi"
    await ds.manager.update(Ingredient, ids.napkin, { consumable: false });
    expect(await lowIds()).toContain(ids.napkin);
    expect(await telegramNames()).toContain('Salfetka');
    expect((await reports.overview()).lowStock).toBe(overview + 1);
  });

  describe('hisobot "Xo\'jalik sarflari"', () => {
    beforeEach(async () => {
      // markaz: 10 pachka (4 500) + 5 gubka (narxsiz); 9-kuni yangi kirim — markazda 10 − 4 = 6 pachka, 5 gubka sarflandi
      await buy(CENTRAL, [{ ingredientId: ids.napkin, qty: 10 }], at(2));
      await ds.manager.update(Ingredient, ids.sponge, { lastPrice: null });
      await warehouse.createPurchase(
        { warehouseId: CENTRAL, items: [{ ingredientId: ids.sponge, qty: 5, price: 0 }] },
        SUPPLIER,
        at(2),
      );
      await ds.manager.update(Ingredient, ids.sponge, { lastPrice: null });
      // Chilonzor: 4 pachka, 12-kuni yana 2 — 4 pachka sarflandi (o'sha paytdagi oxirgi narx — 9-kungi kirimdagi 5 000)
      await send(WC, [{ ingredientId: ids.napkin, qty: 4 }], at(3));
      await buy(
        CENTRAL,
        [
          { ingredientId: ids.napkin, qty: 10, price: 5000 },
          { ingredientId: ids.sponge, qty: 5, price: 3000 },
        ],
        at(9),
      );
      await send(WC, [{ ingredientId: ids.napkin, qty: 2 }], at(12));
    });

    it("filial bo'yicha, barcha omborlar, markazdan sotadigan filial va davr", async () => {
      const napkin = { ingredientId: ids.napkin, name: name('Salfetka') };
      // Chilonzor — o'z ombori: 4 pachka × 5 000
      expect(await reports.consumption({ from: '2026-11-01', to: '2026-11-30', branchId: C })).toEqual([
        { ...napkin, qty: 400, costedQty: 400, cost: 20000 },
      ]);
      // barchasi: markaz 6 pachka × 4 500 (kirimdan oldingi narx) + Chilonzor 20 000; gubka — narxsiz (miqdori bor,
      // summasi yo'q)
      expect(await reports.consumption({ from: '2026-11-01', to: '2026-11-30', branchId: null })).toEqual([
        { ...napkin, qty: 1000, costedQty: 1000, cost: 47000 },
        { ingredientId: ids.sponge, name: name('Gubka'), qty: 5, costedQty: 0, cost: 0 },
      ]);
      // Yunusobod — o'z ombori, sarf yo'q; "Sotuv markaziy ombordan" yoqilsa — markaziy ombor sarfi
      expect(await reports.consumption({ from: '2026-11-01', to: '2026-11-30', branchId: Y })).toEqual([]);
      await ds.manager.update(Branch, Y, { stockFromCentral: true });
      expect(await reports.consumption({ from: '2026-11-01', to: '2026-11-30', branchId: Y })).toEqual([
        { ...napkin, qty: 600, costedQty: 600, cost: 27000 },
        { ingredientId: ids.sponge, name: name('Gubka'), qty: 5, costedQty: 0, cost: 0 },
      ]);
      // davr: 10–11-kun — hech narsa; 12-kun — faqat Chilonzor
      expect(await reports.consumption({ from: '2026-11-10', to: '2026-11-11', branchId: null })).toEqual([]);
      expect(await reports.consumption({ from: '2026-11-12', to: '2026-11-12', branchId: null })).toEqual([
        { ...napkin, qty: 400, costedQty: 400, cost: 20000 },
      ]);
      // noma'lum filial, from > to — bo'sh
      expect(await reports.consumption({ from: '2026-11-01', to: '2026-11-30', branchId: 'br_missing' })).toEqual([]);
      expect(await reports.consumption({ from: '2026-11-30', to: '2026-11-01', branchId: null })).toEqual([]);
    });

    it('HTTP: harakatlar tarixida "Sarflandi" — kirim raqami va qiymati; tovar oynasida switch; hisobot — faqat admin', async () => {
      const login = async (body: object, path = '/api/auth/login') =>
        `Bearer ${(await http().post(path).send(body).expect(200)).body.token as string}`;
      const supplier = await login({ userId: SUPPLIER, pin: '5555' });
      const admin = await login(ADMIN_LOGIN, '/api/auth/admin-login');

      const history = await http()
        .get('/api/movements')
        .query({ warehouseId: CENTRAL, ingredientId: ids.napkin, kind: 'consume' })
        .set({ Authorization: supplier })
        .expect(200);
      const [purchase] = (await warehouse.purchases({ warehouseId: CENTRAL })).items.filter(
        (p) => p.items.some((i) => i.ingredientId === ids.napkin) && p.createdAt.getTime() === at(9).getTime(),
      );
      expect(history.body.items).toMatchObject([{ qty: -600, refId: purchase.id, refNumber: purchase.number, cost: 27000 }]);

      const created = await http()
        .post('/api/ingredients')
        .set({ Authorization: supplier })
        .send({ name: name('Idish yuvish suyuqligi'), group: 'cleaning', unit: 'l', active: true, consumable: true })
        .expect(201);
      expect(created.body.consumable).toBe(true);
      const plain = await http()
        .post('/api/ingredients')
        .set({ Authorization: supplier })
        .send({ name: name('Achitqi'), group: 'other', unit: 'kg', active: true })
        .expect(201);
      expect(plain.body.consumable).toBe(false);
      await http()
        .patch(`/api/ingredients/${plain.body.id}`)
        .set({ Authorization: supplier })
        .send({ name: name('Achitqi'), group: 'other', active: true, consumable: 'ha' })
        .expect(400);

      const query = { from: '2026-11-01', to: '2026-11-30', branchId: C };
      const res = await http().get('/api/reports/consumption').query(query).set({ Authorization: admin }).expect(200);
      expect(res.body).toEqual(await reports.consumption(query));
      await http().get('/api/reports/consumption').query(query).set({ Authorization: supplier }).expect(403);
    });
  });
});
