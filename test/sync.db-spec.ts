import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { newId } from '../src/common/ids';
import { Product } from '../src/menu/product.entity';
import { Order } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { ShiftsService } from '../src/shifts/shifts.service';
import { OfflineKeysService } from '../src/sync/offline-keys.service';
import type { SyncOrder } from '../src/sync/sync.types';
import { StockMovement } from '../src/warehouse/stock-movement.entity';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C, BRANCH_YUNUSOBOD as Y } from './fixtures/demo-data';
import { actor, createTestApp, expectCode } from './test-app';

const CASHIER = 'usr_cashier_c1';

/** Offline kassada olingan buyurtma (markazga yuboriladigan ko'rinishda). */
function offlineOrder(patch: Partial<SyncOrder> = {}): SyncOrder {
  return {
    id: newId('ord'),
    number: 1,
    type: 'dine_in',
    items: [{ productId: 'burger-classic', name: { uz: 'Klassik burger', ru: '', en: '' }, price: 32000, qty: 2 }],
    note: '',
    total: 64000,
    payment: 'cash',
    split: null,
    status: 'preparing',
    cashierId: CASHIER,
    createdAt: new Date().toISOString(),
    readyAt: null,
    cancelledAt: null,
    cancelledBy: null,
    ...patch,
  };
}

/**
 * Markaz tomoni (`/api/sync/*`): filial kaliti, offline kassa uchun nusxa (kassirlar PIN xeshi bilan, menyu, bugungi
 * raqam), internet yo'q paytdagi buyurtmalarni qabul qilish (takrorlanmaydi, smena, ombor, hisoblagich, holat faqat
 * oldinga) va kassa o'zi bergan id bilan buyurtma (qayta yuborilgani ikkinchi marta yozilmaydi).
 */
describe('sync: filial offline kassasi', () => {
  let app: INestApplication;
  let db: DataSource;
  // filial kalitlari — admin "Filiallar" → "Offline kalit" (bazada, `.env` da emas)
  let keyC: string;
  let keyY: string;
  const http = () => request(app.getHttpServer());
  const withKey = (key: string) => ({ 'x-offline-key': key });
  const push = (orders: SyncOrder[], key = keyC) =>
    http().post('/api/sync/orders').set(withKey(key)).send({ orders }).expect(200);
  const sales = (orderId: string) => db.manager.findBy(StockMovement, { refId: orderId });
  const login = async (body: object, path = '/api/auth/login') => (await http().post(path).send(body).expect(200)).body.token as string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false });
    keyC = await app.get(OfflineKeysService).get(C);
    keyY = await app.get(OfflineKeysService).get(Y);
  });

  afterAll(() => app.close());

  describe('kalit', () => {
    it("kalitsiz, maxfiy qismi noto'g'ri, boshqa filial id'si bilan yoki faqat filial id'si — 401", async () => {
      expect(keyC).toMatch(new RegExp(`^${C}\\.[A-Za-z0-9_-]{32}$`));
      await http().get('/api/sync/snapshot').expect(401);
      await http().get('/api/sync/snapshot').set(withKey(`${C}.notogri`)).expect(401);
      // Chilonzor'ning maxfiy qismi Yunusobod id'si bilan — yo'q
      await http().get('/api/sync/snapshot').set(withKey(`${Y}.${keyC.split('.')[1]}`)).expect(401);
      await http().get('/api/sync/snapshot').set(withKey(C)).expect(401);
      const response = await http().post('/api/sync/orders').send({ orders: [] }).expect(401);
      expect(response.body.code).toBe('unauthorized');
      // kalit qaysi filialniki bo'lsa — o'sha filial nomidan
      const snapshot = (await http().get('/api/sync/snapshot').set(withKey(keyY)).expect(200)).body;
      expect(snapshot.branch.id).toBe(Y);
    });

    it("admin: ko'rish (o'sha kalit), yangilash — eskisi darhol ishlamaydi; boshqa rollar — yo'q", async () => {
      const admin = await login(ADMIN_LOGIN, '/api/auth/admin-login');
      const shown = await http().get(`/api/branches/${C}/offline-key`).set({ Authorization: `Bearer ${admin}` }).expect(200);
      expect(shown.body).toEqual({ key: keyC });

      const renewed = await http().post(`/api/branches/${C}/offline-key`).set({ Authorization: `Bearer ${admin}` }).expect(200);
      expect(renewed.body.key).not.toBe(keyC);
      await http().get('/api/sync/snapshot').set(withKey(keyC)).expect(401);
      await http().get('/api/sync/snapshot').set(withKey(renewed.body.key)).expect(200);

      await http().get('/api/branches/br_yoq/offline-key').set({ Authorization: `Bearer ${admin}` }).expect(404);
      const cashier = await login({ userId: CASHIER, pin: '1234' });
      await http().get(`/api/branches/${C}/offline-key`).set({ Authorization: `Bearer ${cashier}` }).expect(403);
      await http().get(`/api/branches/${C}/offline-key`).expect(401);
    });
  });

  describe('nusxa', () => {
    it('filial kassirlari PIN xeshi bilan, kassa menyusi (sotilmaydigani — narxsiz), bugungi raqam', async () => {
      const { body } = await http().get('/api/sync/snapshot').set(withKey(keyY)).expect(200);
      expect(body.unchanged).toBe(false);
      expect(body.branch).toEqual({ id: Y, name: expect.any(String) });
      // faqat shu filialning faol kassirlari (oshpaz yordamchisi, admin, kuryer — yo'q)
      expect(body.cashiers.map((c: { id: string }) => c.id).sort()).toEqual(['usr_cashier_y1', 'usr_cashier_y2']);
      expect(body.cashiers[0].pinHash).toMatch(/^\$2[aby]\$/);
      expect(body.menu.branchId).toBe(Y);
      expect(body.menu.products.find((p: { id: string }) => p.id === 'hotdog-kimchi').price).toBeNull();
      expect(body.menu.products.find((p: { id: string }) => p.id === 'burger-classic').price).toBe(32000);
      expect(Array.isArray(body.images)).toBe(true);
      // xodimlar tizimi yo'li ("Online rejimga qaytish" uchun) — standart `/shorva/`
      expect(body.uiBase).toBe('/shorva/');
      expect(body.counter).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), value: 0 });
    });

    it("o'zgarmagan bo'lsa — faqat versiya va raqam; narx o'zgarsa — yangi versiya", async () => {
      const first = (await http().get('/api/sync/snapshot').set(withKey(keyC)).expect(200)).body;
      const same = (await http().get(`/api/sync/snapshot?since=${first.version}`).set(withKey(keyC)).expect(200)).body;
      expect(same).toEqual({ version: first.version, unchanged: true, counter: first.counter });

      await db.manager.update(Product, 'burger-classic', { price: 33000 });
      const changed = (await http().get(`/api/sync/snapshot?since=${first.version}`).set(withKey(keyC)).expect(200)).body;
      expect(changed.unchanged).toBe(false);
      expect(changed.version).not.toBe(first.version);
    });

    it('bloklangan kassir nusxadan chiqadi', async () => {
      await db.query(`UPDATE users SET active = false WHERE id = 'usr_cashier_c2'`);
      const { body } = await http().get('/api/sync/snapshot').set(withKey(keyC)).expect(200);
      expect(body.cashiers.map((c: { id: string }) => c.id)).toEqual([CASHIER]);
    });
  });

  describe('buyurtmalar', () => {
    it("yoziladi: smena (o'sha paytdagi), ombordan ayirish, hisoblagich; bekor qilingani omborga tegmaydi", async () => {
      const shifts = app.get(ShiftsService);
      const shift = await shifts.openOrResume(CASHIER, C, new Date(Date.now() - 30 * 60_000));
      // bugungi sana (hisoblagich kunlik) — yarim tunga yaqin ishga tushsa ham shu kun ichida qolsin
      const createdAt = new Date(Date.now() - 10 * 60_000);
      const ready = offlineOrder({
        number: 7,
        status: 'ready',
        createdAt: createdAt.toISOString(),
        readyAt: new Date(createdAt.getTime() + 300_000).toISOString(),
        payment: 'cash',
        split: { cash: 40000, card: 24000 },
      });
      const cancelled = offlineOrder({
        number: 8,
        status: 'cancelled',
        createdAt: new Date(createdAt.getTime() + 60_000).toISOString(),
        cancelledAt: new Date(createdAt.getTime() + 120_000).toISOString(),
        cancelledBy: CASHIER,
      });

      const { body } = await push([cancelled, ready]);
      expect(body).toEqual({ accepted: [ready.id, cancelled.id], rejected: [] });

      const saved = await db.manager.findOneByOrFail(Order, { id: ready.id });
      expect(saved).toMatchObject({
        branchId: C,
        number: 7,
        source: 'cashier',
        status: 'ready',
        total: 64000,
        payment: 'cash',
        split: { cash: 40000, card: 24000 },
        cashierId: CASHIER,
        shiftId: shift.id,
        online: null,
      });
      expect(saved.createdAt.toISOString()).toBe(createdAt.toISOString());
      expect(saved.readyAt?.toISOString()).toBe(ready.readyAt);
      expect(saved.syncedAt).toBeInstanceOf(Date);
      // 2 ta klassik burger: 2 × 120 g qiyma — buyurtma vaqti bilan
      const beef = (await sales(ready.id)).find((m) => m.ingredientId === 'beef-mince');
      expect(beef).toMatchObject({ qty: -240, kind: 'sale' });
      expect(beef?.createdAt.toISOString()).toBe(createdAt.toISOString());
      expect(await sales(cancelled.id)).toHaveLength(0);
      expect(await db.manager.findOneByOrFail(Order, { id: cancelled.id })).toMatchObject({
        status: 'cancelled',
        cancelledBy: CASHIER,
      });

      // kassadagi navbatdagi buyurtma offline raqamlardan keyin
      const next = await app.get(OrdersService).createByCashier(actor(CASHIER, 'cashier', C), {
        type: 'dine_in',
        items: [{ productId: 'cola', qty: 1 }],
        payment: 'card',
      });
      expect(next.number).toBe(9);
    });

    it('ikkinchi marta yuborilsa — takrorlanmaydi, ombordan qayta ayrilmaydi', async () => {
      const order = offlineOrder({ number: 3 });
      await push([order]);
      const again = await push([order]);
      expect(again.body).toEqual({ accepted: [order.id], rejected: [] });
      expect(await db.manager.countBy(Order, { id: order.id })).toBe(1);
      expect((await sales(order.id)).filter((m) => m.ingredientId === 'beef-mince')).toHaveLength(1);
    });

    it('holat faqat oldinga: tayyorlanmoqda → tayyor → bekor (ombor qaytadi); orqaga — markazniki qoladi', async () => {
      const order = offlineOrder({ number: 4 });
      await push([order]);
      const readyAt = new Date().toISOString();
      await push([{ ...order, status: 'ready', readyAt }]);
      expect(await db.manager.findOneByOrFail(Order, { id: order.id })).toMatchObject({ status: 'ready' });

      // eski nusxa (tayyorlanmoqda) — o'zgarmaydi
      await push([order]);
      expect(await db.manager.findOneByOrFail(Order, { id: order.id })).toMatchObject({ status: 'ready' });

      await push([{ ...order, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: CASHIER }]);
      expect(await db.manager.findOneByOrFail(Order, { id: order.id })).toMatchObject({ status: 'cancelled' });
      const beef = (await sales(order.id)).filter((m) => m.ingredientId === 'beef-mince').map((m) => [m.kind, m.qty]);
      expect(beef.sort()).toEqual([
        ['sale', -240],
        ['sale_cancel', 240],
      ]);
    });

    it("noto'g'risi rad etiladi (kod bilan), qolganlari yoziladi; boshqa filial buyurtmasi — rad", async () => {
      const good = offlineOrder({ number: 5 });
      const badSplit = offlineOrder({ number: 6, split: { cash: 1000 } });
      const badQty = offlineOrder({
        number: 7,
        items: [{ productId: 'cola', name: { uz: 'Cola', ru: '', en: '' }, price: 9000, qty: 0 }],
      });
      const { body } = await push([good, badSplit, badQty]);
      expect(body.accepted).toEqual([good.id]);
      expect(body.rejected).toEqual([
        { id: badSplit.id, code: 'invalid_amount' },
        { id: badQty.id, code: 'invalid_qty', detail: 'cola' },
      ]);

      // shu id Yunusobod nomidan — boshqa filialniki
      const other = await push([good], keyY);
      expect(other.body.rejected).toEqual([expect.objectContaining({ id: good.id, code: 'forbidden' })]);
    });

    it("smena: o'sha vaqtni qamragan yopilgani; yo'q bo'lsa — hozir ochig'i; u ham yo'q — smenasiz", async () => {
      const shifts = app.get(ShiftsService);
      const morning = await shifts.openOrResume(CASHIER, C, new Date(Date.now() - 6 * 3600_000));
      await shifts.close(morning.id, new Date(Date.now() - 4 * 3600_000));

      const inMorning = offlineOrder({ number: 1, createdAt: new Date(Date.now() - 5 * 3600_000).toISOString() });
      const between = offlineOrder({ number: 2, createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() });
      await push([inMorning, between]);
      expect((await db.manager.findOneByOrFail(Order, { id: inMorning.id })).shiftId).toBe(morning.id);
      expect((await db.manager.findOneByOrFail(Order, { id: between.id })).shiftId).toBeNull();

      const evening = await shifts.openOrResume(CASHIER, C, new Date(Date.now() - 3600_000));
      const later = offlineOrder({ number: 3, createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
      await push([later]);
      expect((await db.manager.findOneByOrFail(Order, { id: later.id })).shiftId).toBe(evening.id);
    });
  });

  describe('kassa bergan id', () => {
    it("qayta yuborilgan buyurtma ikkinchi marta yozilmaydi; boshqa kassir shu id bilan — xato", async () => {
      const orders = app.get(OrdersService);
      await app.get(ShiftsService).openOrResume(CASHIER, C);
      const id = newId('ord');
      const dto = { id, type: 'takeaway' as const, items: [{ productId: 'cola', qty: 2 }], payment: 'cash' as const };
      const first = await orders.createByCashier(actor(CASHIER, 'cashier', C), dto);
      const again = await orders.createByCashier(actor(CASHIER, 'cashier', C), dto);
      expect(again).toMatchObject({ id, number: first.number, total: 18000 });
      expect(await db.manager.countBy(Order, { id })).toBe(1);
      expect((await sales(id)).filter((m) => m.kind === 'sale')).toHaveLength(1);

      await app.get(ShiftsService).openOrResume('usr_cashier_c2', C);
      await expectCode('invalid_input', () => orders.createByCashier(actor('usr_cashier_c2', 'cashier', C), dto));
    });

    it("id shakli tekshiriladi (`ord_` + 16 hex)", async () => {
      const login = await http().post('/api/auth/login').send({ userId: CASHIER, pin: '1234' }).expect(200);
      const response = await http()
        .post('/api/orders')
        .set({ Authorization: `Bearer ${login.body.token}` })
        .send({ id: 'ord_xyz', type: 'dine_in', items: [{ productId: 'cola', qty: 1 }], payment: 'cash' })
        .expect(400);
      expect(response.body.code).toBe('invalid_input');
    });
  });
});
