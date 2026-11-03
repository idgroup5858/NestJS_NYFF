import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { BranchesService } from '../src/branches/branches.service';
import type { Branch } from '../src/branches/branch.entity';
import { Warehouse } from '../src/branches/warehouse.entity';
import { addDays, dateKey } from '../src/domain/dates';
import { READY_SHOWN_MS } from '../src/domain/orders';
import { seedDemo } from './fixtures/demo';
import { Expense } from '../src/expenses/expense.entity';
import { ExpensesService } from '../src/expenses/expenses.service';
import { Category } from '../src/menu/category.entity';
import { MenuService } from '../src/menu/menu.service';
import { Product } from '../src/menu/product.entity';
import type { CreateOrderDto, KioskOrderDto, MobileOrderDto } from '../src/orders/order.dto';
import { Order } from '../src/orders/order.entity';
import type { OrderView } from '../src/orders/order.views';
import { OrdersService } from '../src/orders/orders.service';
import { ReportsService } from '../src/reports/reports.service';
import type { Shift } from '../src/shifts/shift.entity';
import { ShiftsService } from '../src/shifts/shifts.service';
import { UsersService } from '../src/users/users.service';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { actor, createTestApp, expectCode } from './test-app';

/**
 * Frontend `scripts/logic-smoke.ts` — endi haqiqiy Postgres'da, servislar orqali, frontenddagi tartibda. Frontend har
 * qadamda bazaning yangi nusxasini oladi; bu yerda baza bitta — shuning uchun frontend "alohida nusxada" tekshirgan
 * qismlar (mobil buyurtma) alohida `describe` da, toza bazada.
 *
 * Boshqa fayllarda: demo baza butunligi — `demo.db-spec.ts`; yetkazib berish, ish vaqti, qabul muddati —
 * `logic-online.db-spec.ts`; PIN bloki, huquqlar, bir vaqtdagi so'rovlar — `logic-guards.db-spec.ts`; geometriya va
 * aralash to'lovning sof funksiyalari — `src/domain/domain.spec.ts`.
 * Backendda yo'q (o'tkazib yuborildi): `insertPoint` (xarita UI yordamchisi), `withDeliveryFields` va `withKitchenStaff`
 * (localStorage'dagi eski bazani ko'chirish), `JSON.stringify(demo).length` (localStorage hajmi).
 */

const now = new Date('2026-10-23T12:00:00');
const C = 'br_chilonzor';
const Y = 'br_yunusobod';
const WC = 'wh_chilonzor';
const WY = 'wh_yunusobod';
const CENTRAL = 'wh_central';
const IN_CHILONZOR = { lat: 41.28, lng: 69.2 };

const admin = actor('usr_admin', 'admin');
const c1 = actor('usr_cashier_c1', 'cashier', C);
const c2 = actor('usr_cashier_c2', 'cashier', C);
const y1 = actor('usr_cashier_y1', 'cashier', Y);
const kitchenC = actor('usr_kitchen_c1', 'kitchen', C);
const kitchenY = actor('usr_kitchen_y1', 'kitchen', Y);

describe('biznes mantiq (frontend logic-smoke.ts)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let orders: OrdersService;
  let shifts: ShiftsService;
  let warehouse: WarehouseService;
  let auth: AuthService;
  let users: UsersService;
  let branches: BranchesService;
  let menu: MenuService;
  let expenses: ExpensesService;
  let reports: ReportsService;

  beforeAll(async () => {
    app = await createTestApp();
    em = app.get(DataSource).manager;
    orders = app.get(OrdersService);
    shifts = app.get(ShiftsService);
    warehouse = app.get(WarehouseService);
    auth = app.get(AuthService);
    users = app.get(UsersService);
    branches = app.get(BranchesService);
    menu = app.get(MenuService);
    expenses = app.get(ExpensesService);
    reports = app.get(ReportsService);
  });

  afterAll(() => app.close());

  /** Ombordagi qoldiq (asosiy birlikda); yozuv bo'lmasa — 0 (frontend `stockQty`). */
  const stockQty = async (warehouseId: string, ingredientId: string) =>
    (await em.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;
  const findOrder = (id: string) => em.findOneByOrFail(Order, { id });

  describe('jonli demo (createSeedDb)', () => {
    // demo bazadagi qolgan tekshiruvlar (buyurtmalar soni, faol buyurtmalar, hujjatlar) — demo.db-spec.ts da
    it("30 kunlik hisobot: tushum va chiqim bor, kunlar va to'lov turlari yig'indisi — tushum", async () => {
      await seedDemo(app, { activity: true }, now);
      const month = await reports.sales({
        from: addDays(dateKey(now), -29),
        to: dateKey(now),
        branchId: null,
      });
      expect(month.revenue).toBeGreaterThan(0);
      expect(month.expenses).toBeGreaterThan(0);
      expect(month.days).toHaveLength(30);
      expect(month.days.reduce((sum, day) => sum + day.revenue, 0)).toBe(month.revenue);
      expect(Object.values(month.byPayment).reduce((a, b) => a + b, 0)).toBe(month.revenue);
    });
  });

  describe('kassa → oshxona → ombor → admin (createBaseDb, frontend tartibida, bitta baza)', () => {
    let shift: Shift;
    let yShift: Shift;
    let first: OrderView;
    let second: Order;
    let yOrder: OrderView;
    let kioskOrderId: string;
    let third: OrderView;
    let sergeli: Branch;

    const burger = (qty = 1) => [{ productId: 'burger-classic', qty }];

    beforeAll(async () => {
      await seedDemo(app, { activity: false }, now);
    });

    it('smena ochilmaguncha kassir buyurtma bera olmaydi; kirganda smena ochiladi, qayta kirsa — davom etadi', async () => {
      await expectCode('shift_not_open', () =>
        orders.createByCashier(c1, { type: 'dine_in', items: burger(), payment: 'cash' }, now),
      );
      shift = await shifts.openOrResume('usr_cashier_c1', C, now);
      expect((await shifts.openOrResume('usr_cashier_c1', C, now)).id).toBe(shift.id);
      // PIN bilan kirish ham o'sha smenani davom ettiradi
      expect((await auth.login('usr_cashier_c1', '1234', C, now)).shift?.id).toBe(shift.id);
    });

    it("birinchi buyurtma: raqam 1, taom narxi, smenaga yoziladi, retsept bo'yicha ombordan ayriladi", async () => {
      const mince0 = await stockQty(WC, 'beef-mince');
      const bun0 = await stockQty(WC, 'bun-burger');
      first = await orders.createByCashier(
        c1,
        {
          type: 'dine_in',
          items: [
            { productId: 'burger-classic', qty: 2 },
            { productId: 'cola', qty: 1 },
          ],
          payment: 'cash',
        },
        now,
      );
      expect(first.number).toBe(1);
      expect(first.total).toBe(32000 * 2 + 9000);
      expect(first.shiftId).toBe(shift.id);
      // taomga izoh yo'q — qatorda faqat taom, nom, narx va soni
      expect(Object.keys(first.items[0]).sort()).toEqual(['name', 'price', 'productId', 'qty']);
      expect(await stockQty(WC, 'beef-mince')).toBe(mince0 - 240); // go'sht 2 × 120 g
      expect(await stockQty(WC, 'bun-burger')).toBe(bun0 - 2);
    });

    it('kiosk (karta bilan): navbatdagi raqam, smenasiz, kassirsiz', async () => {
      const view = await orders.createByKiosk(
        { branchId: C, type: 'takeaway', items: [{ productId: 'fries', qty: 1 }], payment: 'card' },
        now,
      );
      second = await findOrder(view.id);
      expect(second.number).toBe(2);
      expect(second.shiftId).toBeNull();
      expect(second.cashierId).toBeNull();
      expect(second.status).toBe('preparing');
    });

    it("Yunusobod: o'z raqamlari, narx bir xil, kimchi hot-dog vaqtincha sotilmaydi", async () => {
      yShift = await shifts.openOrResume('usr_cashier_y1', Y, now);
      yOrder = await orders.createByCashier(y1, { type: 'delivery', items: burger(), payment: 'click' }, now);
      expect(yOrder.number).toBe(1);
      expect(yOrder.total).toBe(32000);
      await expectCode('product_unavailable', () =>
        orders.createByCashier(
          y1,
          { type: 'dine_in', items: [{ productId: 'hotdog-kimchi', qty: 1 }], payment: 'cash' },
          now,
        ),
      );
    });

    it('faqat zalda beriladigan taom (choynakdagi choy): menyuda belgisi bor, olib ketish / dostavkada — dine_in_only', async () => {
      await em.update(Product, 'tea', { dineInOnly: true });
      try {
        const kassaMenu = await menu.publicMenu(C, true);
        expect(kassaMenu.products.find((p) => p.id === 'tea')?.dineInOnly).toBe(true);
        expect(kassaMenu.products.find((p) => p.id === 'fries')?.dineInOnly).toBe(false);
        const tea = [{ productId: 'tea', qty: 1 }, ...burger()];
        await expectCode('dine_in_only', () =>
          orders.createByKiosk({ branchId: C, type: 'takeaway', items: tea, payment: 'card' }, now),
        );
        await expectCode('dine_in_only', () =>
          orders.createByCashier(c1, { type: 'takeaway', items: tea, payment: 'cash' }, now),
        );
        await expectCode('dine_in_only', () =>
          orders.createByCashier(c1, { type: 'delivery', items: tea, payment: 'cash' }, now),
        );
      } finally {
        await em.update(Product, 'tea', { dineInOnly: false });
      }
    });

    it('ertasi kuni raqam yana 1 dan', async () => {
      const tomorrow = new Date('2026-10-24T09:00:00');
      const order = await orders.createByKiosk(
        { branchId: C, type: 'dine_in', items: [{ productId: 'tea', qty: 1 }], payment: 'card' },
        tomorrow,
      );
      expect(order.number).toBe(1);
    });

    it("aralash to'lov: qismlar yig'indisi = summa, asosiy tur — eng katta qism; smena tushumida qismlar bo'yicha", async () => {
      const dto: CreateOrderDto = { type: 'dine_in', items: burger(), payment: 'cash' };
      const mixed = await orders.createByCashier(y1, { ...dto, split: { cash: 12000, card: 20000 } }, now);
      expect(mixed.payment).toBe('card');
      expect(mixed.split).toEqual({ cash: 12000, card: 20000 });
      await expectCode('invalid_amount', () =>
        orders.createByCashier(y1, { ...dto, split: { cash: 10000, card: 20000 } }, now),
      );
      await expectCode('invalid_amount', () =>
        orders.createByCashier(y1, { ...dto, split: { cash: 32000 } }, now),
      );
      // frontend `orderPayments` — smena hisobida (SQL): dostavka Click 32 000 + aralash 12 000 / 20 000
      expect((await shifts.findOne(yShift.id, admin)).summary).toEqual({
        orderCount: 2,
        cancelledCount: 0,
        total: 64000,
        byPayment: { cash: 12000, card: 20000, click: 32000 },
      });
    });

    it('to\'langan buyurtma darhol tayyorlanmoqda; "Tayyor" — faqat shu filialning oshpaz yordamchisi; TV dan o\'zi tushadi', async () => {
      expect(first.status).toBe('preparing');
      expect(first.preparingAt).toEqual(now);
      await expectCode('forbidden', () => orders.markReady(first.id, c1, now));
      await expectCode('forbidden', () => orders.markReady(first.id, kitchenY, now));
      const ready = await orders.markReady(first.id, kitchenC, now);
      expect(ready.status).toBe('ready');
      expect(ready.readyAt).toEqual(now);
      await expectCode('invalid_status', () => orders.markReady(first.id, kitchenC, now));
      expect((await orders.recentReady(C, now)).map((o) => o.id)).toEqual([first.id]);
      expect(await orders.recentReady(C, new Date(now.getTime() + READY_SHOWN_MS + 1000))).toHaveLength(0);
    });

    it("kiosk «kassada to'layman»: kassir pulini olib tasdiqlaguncha oshxonaga ham, omborga ham tegmaydi", async () => {
      const mince1 = await stockQty(WC, 'beef-mince');
      const kioskDto: KioskOrderDto = { branchId: C, type: 'takeaway', items: burger(), payment: null };
      const kioskOrder = await orders.createByKiosk(kioskDto, now);
      kioskOrderId = kioskOrder.id;
      expect(kioskOrder.status).toBe('pending');
      expect(kioskOrder.payment).toBeNull();
      expect(await stockQty(WC, 'beef-mince')).toBe(mince1);
      expect((await orders.active(C)).find((o) => o.id === kioskOrder.id)?.status).toBe('pending');

      // kassir to'lovsiz buyurtma bera olmaydi
      await expectCode('invalid_amount', () =>
        orders.createByCashier(c1, { ...kioskDto, payment: null }, now),
      );
      await expectCode('invalid_status', () => orders.markReady(kioskOrder.id, kitchenC, now));
      // Sardorning smenasi ochilmagan
      await expectCode('shift_not_open', () => orders.confirm(kioskOrder.id, c2, { payment: 'cash' }, now));

      const confirmed = await orders.confirm(kioskOrder.id, c1, { payment: 'cash' }, now);
      expect(confirmed.status).toBe('preparing');
      expect(confirmed.payment).toBe('cash');
      expect(confirmed.shiftId).toBe(shift.id);
      expect(confirmed.cashierId).toBe('usr_cashier_c1');
      expect(await stockQty(WC, 'beef-mince')).toBe(mince1 - 120);
      await expectCode('invalid_status', () => orders.confirm(kioskOrder.id, c1, { payment: 'cash' }, now));

      // to'lanmagan kiosk buyurtmasini bekor qilish omborga tegmaydi
      const unpaid = await orders.createByKiosk(kioskDto, now);
      await orders.cancel(unpaid.id, c1, now);
      expect(await stockQty(WC, 'beef-mince')).toBe(mince1 - 120);
    });

    it('TV: faqat kassa / kiosk, zalda yoki olib ketish; dostavka chiqmaydi', async () => {
      const tvC = await orders.tvQueue(C, now);
      expect(tvC.ready.map((o) => o.id)).toEqual([first.id]); // kassa, zalda
      expect(tvC.preparing.map((o) => o.id)).toEqual(expect.arrayContaining([second.id, kioskOrderId])); // kiosk
      const tvY = await orders.tvQueue(Y, now);
      expect(tvY.preparing.some((o) => o.id === yOrder.id)).toBe(false); // kassa, dostavka
      expect(tvY.preparing).toHaveLength(1); // faqat aralash to'lovli (zalda)
      // oshxona (faol buyurtmalar) ro'yxatida dostavka bor
      expect((await orders.active(Y)).some((o) => o.id === yOrder.id)).toBe(true);
    });

    it('bekor qilish: ombor aynan qaytadi', async () => {
      const fries0 = await stockQty(WC, 'potato-fries');
      await orders.cancel(second.id, c1, now);
      expect(await stockQty(WC, 'potato-fries')).toBe(fries0 + 150);
    });

    it("smena hisobi va yopish; yopilgan smenani qayta yopib bo'lmaydi", async () => {
      const expected = {
        orderCount: 2,
        cancelledCount: 0,
        total: 105000,
        byPayment: { cash: 105000, card: 0, click: 0 },
      };
      expect((await shifts.findOne(shift.id, c1)).summary).toEqual(expected);
      const closed = await shifts.close(shift.id, now);
      expect(closed.closedAt).toEqual(now);
      expect(closed.summary).toEqual(expected);
      await expectCode('shift_not_open', () => shifts.close(shift.id, now));
    });

    it("kirim: tasdiqlanmaguncha omborga qo'shilmaydi; tasdiqda narx va qoldiq yangilanadi", async () => {
      const tomato0 = await stockQty(CENTRAL, 'tomato');
      const purchase = await warehouse.createPurchase(
        {
          warehouseId: CENTRAL,
          items: [
            { ingredientId: 'tomato', qty: 12.5 },
            { ingredientId: 'napkin', qty: 1000 },
          ],
        },
        'usr_supplier',
        now,
      );
      expect(purchase.items[0].price).toBe(14000); // oldingi narx avtomatik
      expect(await stockQty(CENTRAL, 'tomato')).toBe(tomato0);

      const approved = await warehouse.approvePurchase(purchase.id, { tomato: 15000 }, 'usr_admin', now);
      expect(await stockQty(CENTRAL, 'tomato')).toBe(tomato0 + 12500);
      expect((await em.findOneByOrFail(Ingredient, { id: 'tomato' })).lastPrice).toBe(15000);
      // frontend `purchaseTotal`
      expect(approved.items.reduce((sum, item) => sum + item.qty * (item.price ?? 0), 0)).toBe(
        12.5 * 15000 + 1000 * 50,
      );
      await expectCode('already_decided', () => warehouse.approvePurchase(purchase.id, {}, 'usr_admin', now));
    });

    it("ko'chirish: biridan chiqim, ikkinchisiga kirim; bir xil ombor va qoldiqdan ko'p — xato", async () => {
      const cheddarC0 = await stockQty(WC, 'cheddar');
      const cheddarW0 = await stockQty(CENTRAL, 'cheddar');
      await warehouse.createTransfer(
        { fromWarehouseId: CENTRAL, toWarehouseId: WC, items: [{ ingredientId: 'cheddar', qty: 3 }] },
        'usr_supplier',
        now,
      );
      expect(await stockQty(WC, 'cheddar')).toBe(cheddarC0 + 3000);
      expect(await stockQty(CENTRAL, 'cheddar')).toBe(cheddarW0 - 3000);
      await expectCode('same_warehouse', () =>
        warehouse.createTransfer(
          { fromWarehouseId: WY, toWarehouseId: WY, items: [{ ingredientId: 'cheddar', qty: 1 }] },
          'usr_supplier',
          now,
        ),
      );
      await expectCode('insufficient_stock', () =>
        warehouse.createTransfer(
          { fromWarehouseId: WC, toWarehouseId: WY, items: [{ ingredientId: 'cheddar', qty: 50 }] },
          'usr_supplier',
          now,
        ),
      );
      expect(await stockQty(WC, 'cheddar')).toBe(cheddarC0 + 3000);
    });

    it("PIN: noto'g'ri — wrong_pin; yangi PIN faqat raqamlardan; almashtirilgach eskisi ishlamaydi", async () => {
      await expectCode('wrong_pin', () => auth.checkPin('usr_cashier_c1', '0000', now));
      await expectCode('invalid_pin', () => auth.changeOwnPin('usr_cashier_c1', '1234', '12a4', now));
      await auth.changeOwnPin('usr_cashier_c1', '1234', '987654', now);
      expect((await auth.checkPin('usr_cashier_c1', '987654', now)).id).toBe('usr_cashier_c1');
      await expectCode('wrong_pin', () => auth.checkPin('usr_cashier_c1', '1234', now));
    });

    it('adashib "tayyor" deyilganini faqat oshpaz yordamchisi qaytaradi; bloklangan xodim bosa olmaydi', async () => {
      await shifts.openOrResume('usr_cashier_c2', C, now);
      third = await orders.createByCashier(
        c2,
        { type: 'dine_in', items: [{ productId: 'tea', qty: 1 }], payment: 'cash' },
        now,
      );
      await orders.markReady(third.id, kitchenC, now);
      await expectCode('forbidden', () => orders.reopen(third.id, c2, now));
      const reopened = await orders.reopen(third.id, kitchenC, now);
      expect(reopened.status).toBe('preparing');
      expect(reopened.readyAt).toBeNull();
      await expectCode('invalid_status', () => orders.reopen(third.id, kitchenC, now));

      // bloklangan oshpaz yordamchisi: servis rolni tokendan oladi, token esa har so'rovda bazadan tekshiriladi
      const { token } = await auth.login('usr_kitchen_c1', '1111', C, now);
      const kitchen = { name: 'Aziz', surname: 'Qodirov', role: 'kitchen' as const, branchIds: [C], pin: '' };
      await users.save({ id: 'usr_kitchen_c1', ...kitchen, active: false }, 'usr_admin', now);
      const res = await request(app.getHttpServer())
        .post(`/api/orders/${third.id}/ready`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(res.body.code).toBe('unauthorized');
      await expectCode('user_inactive', () => auth.checkPin('usr_kitchen_c1', '1111', now));
      expect((await findOrder(third.id)).status).toBe('preparing');
      // frontendda bu alohida nusxada edi — qayta faollashtiramiz
      await users.save({ id: 'usr_kitchen_c1', ...kitchen, active: true }, 'usr_admin', now);
    });

    it("admin: yangi filial — o'z ombori, hamma taom o'sha narxda sotuvda; nomsiz — name_required", async () => {
      sergeli = await branches.create({ name: '  Sergeli ', address: '', phone: '', active: true }, now);
      expect(sergeli.name).toBe('Sergeli');
      expect(await em.existsBy(Warehouse, { branchId: sergeli.id, kind: 'branch' })).toBe(true);
      expect((await menu.publicMenu(sergeli.id)).products.find((p) => p.id === 'burger-classic')?.price).toBe(
        32000,
      );
      await expectCode('name_required', () =>
        branches.create({ name: ' ', address: '', phone: '', active: true }, now),
      );
    });

    it("admin: xodimlar — filial, PIN, bo'sh PIN eskisini qoldiradi, o'zini bloklay olmaydi", async () => {
      const save = (input: Parameters<UsersService['save']>[0]) => users.save(input, 'usr_admin', now);
      await expectCode('branch_required', () =>
        save({ name: 'Ali', surname: 'Valiyev', role: 'cashier', branchIds: [], pin: '1234', active: true }),
      );
      await expectCode('branch_required', () =>
        save({ name: 'Olim', surname: 'Hasanov', role: 'kitchen', branchIds: [], pin: '1234', active: true }),
      );
      await expectCode('invalid_pin', () =>
        save({ name: 'Ali', surname: 'Valiyev', role: 'cashier', branchIds: [sergeli.id], pin: '12', active: true }),
      );
      const ali = await save({
        name: 'Ali',
        surname: 'Valiyev',
        role: 'cashier',
        branchIds: [sergeli.id],
        pin: '2468',
        active: true,
      });
      await save({
        id: ali.id,
        name: 'Ali V.',
        surname: 'Valiyev',
        role: 'cashier',
        branchIds: [sergeli.id],
        pin: '',
        active: true,
      });
      expect((await auth.checkPin(ali.id, '2468', now)).name).toBe('Ali V.');
      await expectCode('self_action', () =>
        save({ id: 'usr_admin', name: 'Admin', surname: 'Adminov', role: 'admin', email: 'admin@gmail.com', active: false }),
      );
      const vali = await save({ name: 'Vali', surname: 'Karimov', role: 'supplier', branchIds: [C], pin: '1357', active: true });
      expect(vali.branchIds).toEqual([]);
    });

    it('admin: menyu — kategoriya, retsept birlashadi, narx bitta, filialda vaqtincha sotilmaydi, tartib', async () => {
      const pizza = await menu.saveCategory({
        name: { uz: 'Pitsa', ru: '', en: '' },
        image: '',
        icon: '/images/icons/pizza.png',
        active: true,
      });
      expect(pizza.sortOrder).toBe(7);
      const draft = {
        categoryId: pizza.id,
        name: { uz: 'Margarita', ru: 'Маргарита', en: 'Margherita' },
        image: '',
        recipe: [
          { ingredientId: 'mozzarella', qty: 80 },
          { ingredientId: 'tomato', qty: 40 },
          { ingredientId: 'mozzarella', qty: 20 },
        ],
        price: 45000,
        unavailableBranchIds: [],
        active: true,
      };
      await expectCode('recipe_required', () => menu.saveProduct({ ...draft, recipe: [] }));
      await expectCode('invalid_price', () => menu.saveProduct({ ...draft, price: 0 }));
      await expectCode('invalid_price', () => menu.saveProduct({ ...draft, price: 450.5 }));
      await expectCode('not_found', () =>
        menu.saveProduct({ ...draft, unavailableBranchIds: ['br_missing'] }),
      );
      const margarita = await menu.saveProduct(draft);
      expect(margarita.recipe).toEqual([
        { ingredientId: 'mozzarella', qty: 100 },
        { ingredientId: 'tomato', qty: 40 },
      ]);

      // kassa / kiosk menyusidagi narx — hamma filialda bir xil; filialda vaqtincha sotilmasa — `null`
      const menuPrice = async (branchId: string) =>
        (await menu.publicMenu(branchId, true)).products.find((p) => p.id === margarita.id)?.price;
      expect(await menuPrice(C)).toBe(45000);
      expect(await menuPrice(Y)).toBe(45000);
      const stopped = await menu.saveProduct({ ...draft, id: margarita.id, unavailableBranchIds: [C, C] });
      expect(stopped.unavailableBranchIds).toEqual([C]);
      expect(await menuPrice(C)).toBeNull();
      expect(await menuPrice(Y)).toBe(45000);
      expect((await menu.publicMenu(C)).products.some((p) => p.id === margarita.id)).toBe(false);
      await expectCode('product_unavailable', () =>
        orders.createByCashier(
          c2,
          { type: 'dine_in', items: [{ productId: margarita.id, qty: 1 }], payment: 'cash' },
          now,
        ),
      );

      await menu.moveCategory(pizza.id, -1);
      expect((await em.findOneByOrFail(Category, { id: pizza.id })).sortOrder).toBe(6);
      expect((await em.findOneByOrFail(Category, { id: 'drinks' })).sortOrder).toBe(7);
      const burgerIds = async () =>
        (await em.find(Product, { where: { categoryId: 'burgers' }, order: { sortOrder: 'ASC' } })).map(
          (p) => p.id,
        );
      const before = await burgerIds();
      await menu.moveProduct(before[0], 1);
      expect((await burgerIds()).slice(0, 2)).toEqual([before[1], before[0]]);
    });

    it("ombor mahsuloti narxsiz yaratiladi; chegara qo'yilsa — 0 qoldiq bilan ogohlantirishga tushadi", async () => {
      const basil = await warehouse.saveIngredient(
        {
          name: { uz: 'Rayhon', ru: 'Базилик', en: 'Basil' },
          group: 'vegetables',
          unit: 'kg',
          active: true,
        },
        'supplier',
      );
      expect(basil.lastPrice).toBeNull();
      await warehouse.setMinQty(WC, basil.id, 500);
      expect(await em.findOneBy(StockItem, { warehouseId: WC, ingredientId: basil.id })).toEqual({
        warehouseId: WC,
        ingredientId: basil.id,
        qty: 0,
        minQty: 500,
      });
      expect((await warehouse.lowStock(WC)).some((s) => s.ingredientId === basil.id)).toBe(true);
    });

    it('chiqim va hisobot: bekor qilinganlar tushumga kirmaydi, chiqim tushumdan ayriladi', async () => {
      await expectCode('invalid_amount', () =>
        expenses.create({ branchId: C, kind: 'gas', amount: -5, date: '2026-10-20' }, 'usr_admin', now),
      );
      const gas = await expenses.create(
        { branchId: C, kind: 'gas', amount: 1_200_000, date: '2026-10-20' },
        'usr_admin',
        now,
      );
      const report = await reports.sales({ from: '2026-10-17', to: '2026-10-23', branchId: C });
      // birinchi + kassada to'langan kiosk + choy; bekor: kiosk (fri) va to'lanmagan kiosk
      expect(report.orders).toBe(3);
      expect(report.cancelled).toBe(2);
      expect(report.revenue).toBe(73000 + 32000 + 4000);
      expect(report.expenses).toBe(1_200_000);
      expect(report.net).toBe(109000 - 1_200_000);
      expect(report.days).toHaveLength(7);
      expect(report.topProducts[0].productId).toBe('burger-classic');
      await expenses.remove(gas.id);
      expect(await em.count(Expense)).toBe(0);
    });
  });

  describe('mobil ilova (frontendda alohida nusxada)', () => {
    const online = {
      platform: 'ios',
      name: ' Aziz ',
      phone: '+998 90 123 45 67',
      address: ' Chilonzor 9 ',
      payment: 'click',
      location: IN_CHILONZOR,
    } as const;
    const items = [{ productId: 'burger-classic', qty: 1 }];
    const delivery = (patch: Partial<MobileOrderDto['online']> = {}) =>
      orders.createByMobile({ type: 'delivery', items, online: { ...online, ...patch } }, now);
    let shift: Shift;

    beforeAll(async () => {
      await seedDemo(app, { activity: false }, now);
      shift = await shifts.openOrResume('usr_cashier_c1', C, now);
    });

    it("kassir qabul qilguncha kutadi; telefon majburiy, manzil — joy tanlanmagan bo'lsa; qabulda mijoz tanlagan to'lov yoziladi", async () => {
      const mince1 = await stockQty(WC, 'beef-mince');
      const { order } = await delivery();
      expect(order.status).toBe('pending');
      expect(order.branchId).toBe(C);
      expect(order.online).toEqual({ ...online, name: 'Aziz', address: 'Chilonzor 9' });
      expect(await stockQty(WC, 'beef-mince')).toBe(mince1); // qabul qilinmaguncha omborga tegmaydi

      await expectCode('phone_required', () => delivery({ phone: '+998 9' }));
      // xaritadan joy yo'q — manzil matni majburiy (joy bo'lsa ixtiyoriy — testning oxirida)
      await expectCode('address_required', () => delivery({ address: '  ', location: null }));
      await expectCode('invalid_status', () =>
        orders.createByMobile({ type: 'dine_in', branchId: C, items, online }, now),
      );
      // mobil buyurtma to'lov bilan kelmaydi (to'lovni kassir qabulda mijoz tanlaganidan yozadi)
      await expectCode('invalid_amount', () =>
        orders.place(
          {
            branchId: C,
            type: 'delivery',
            source: 'mobile',
            items,
            payment: 'click',
            cashierId: null,
            online,
          },
          now,
        ),
      );
      const pickup = (await orders.createByMobile({ type: 'takeaway', branchId: C, items, online }, now))
        .order;
      expect(pickup.online?.address).toBe(''); // olib ketishda manzil saqlanmaydi

      // qabul: kassir yuborgan to'lov emas — mijoz tanlagani (Click)
      const accepted = await orders.confirm(order.id, c1, { payment: 'cash' }, now);
      expect(accepted.status).toBe('preparing');
      expect(accepted.payment).toBe('click');
      expect(accepted.shiftId).toBe(shift.id);
      expect(await stockQty(WC, 'beef-mince')).toBe(mince1 - 120);
      const report = await reports.sales({ from: '2026-10-23', to: '2026-10-23', branchId: C });
      expect(report.bySource.mobile.orders).toBe(1);

      // TV ga mobil ilovadagilar chiqmaydi (olib ketish ham), kioskdagi olib ketish — chiqadi
      await orders.confirm(pickup.id, c1, {}, now);
      const kiosk = await orders.createByKiosk(
        { branchId: C, type: 'takeaway', items, payment: 'card' },
        now,
      );
      expect((await orders.tvQueue(C, now)).preparing.map((o) => o.id)).toEqual([kiosk.id]);
      expect((await orders.active(C)).map((o) => o.id).sort()).toEqual(
        [order.id, pickup.id, kiosk.id].sort(),
      );

      // xaritadan joy tanlangan — manzil matnisiz ham qabul qilinadi
      const pinOnly = (await delivery({ address: '  ' })).order;
      expect(pinOnly.status).toBe('pending');
      expect(pinOnly.online?.address).toBe('');
      expect(pinOnly.online?.location).toEqual(IN_CHILONZOR);
    });
  });
});
