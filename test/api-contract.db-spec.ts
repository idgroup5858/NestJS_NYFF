import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DemoService } from '../src/demo/demo.service';
import { OrdersService } from '../src/orders/orders.service';
import { ShiftsService } from '../src/shifts/shifts.service';
import { createTestApp } from './test-app';

/**
 * HTTP shartnomasi (API.md): statuslar (yaratish 201, amal 200, o'chirish 204), bo'sh javob tanasi yo'q, chegaraviy
 * qiymatlar 500 emas — xato kodi, va API ko'rib chiqishda topilgan holatlar.
 */
describe('HTTP shartnomasi', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (user: string) => ({ Authorization: `Bearer ${tokens[user]}` });

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(DemoService).reset({ activity: false });
    for (const [user, pin] of [
      ['usr_admin', '0000'],
      ['usr_supplier', '5555'],
      ['usr_cashier_c1', '1234'],
    ]) {
      tokens[user] = (await http().post('/api/auth/login').send({ userId: user, pin }).expect(200)).body.token;
    }
  });

  afterAll(() => app.close());

  it('smena: `{ shift }` (bo\'sh tana emas), amallar — 200', async () => {
    // login kassir smenasini ochgan — avval yopamiz
    await http().post('/api/shifts/current/close').set(as('usr_cashier_c1')).expect(200);
    expect((await http().get('/api/shifts/current').set(as('usr_cashier_c1')).expect(200)).body).toEqual({ shift: null });
    const opened = await http().post('/api/shifts/current').set(as('usr_cashier_c1')).expect(200);
    const current = await http().get('/api/shifts/current').set(as('usr_cashier_c1')).expect(200);
    expect(current.body.shift.id).toBe(opened.body.id);
  });

  it("menyu: surish — 204; taom narxi son bo'lib qaytadi, filialda vaqtincha sotilmasa kassa menyusida `price: null`", async () => {
    const moved = await http().post('/api/categories/hotdogs/move').set(as('usr_admin')).send({ direction: -1 }).expect(204);
    expect(moved.text).toBe('');
    const products = (await http().get('/api/products').set(as('usr_admin')).expect(200)).body as Record<string, unknown>[];
    const { id, sortOrder, ...tea } = products.find((p) => p.id === 'tea')!;
    expect(tea).toMatchObject({ price: 4000, unavailableBranchIds: [] });
    const saved = await http()
      .patch(`/api/products/${String(id)}`)
      .set(as('usr_admin'))
      .send({ ...tea, price: 5000, unavailableBranchIds: ['br_yunusobod'] })
      .expect(200);
    expect(saved.body).toMatchObject({ price: 5000, unavailableBranchIds: ['br_yunusobod'] });
    const menuPrice = async (branchId: string) => {
      const menu = await http().get(`/api/menu?branchId=${branchId}&all=true`).expect(200);
      return (menu.body.products as { id: string; price: number | null }[]).find((p) => p.id === id)?.price;
    };
    expect(await menuPrice('br_chilonzor')).toBe(5000);
    expect(await menuPrice('br_yunusobod')).toBeNull();
    await http().put('/api/prices').set(as('usr_admin')).send({}).expect(404);
  });

  it("chiqim: mavjud bo'lmagan sana — 500 emas; o'chirish — 204", async () => {
    const expense = { branchId: 'br_chilonzor', kind: 'gas', amount: 100_000 };
    const bad = await http().post('/api/expenses').set(as('usr_admin')).send({ ...expense, date: '2026-02-30' }).expect(400);
    expect(bad.body.code).toBe('invalid_amount');
    const badQuery = await http().get('/api/expenses?from=2026-02-30').set(as('usr_admin')).expect(400);
    expect(badQuery.body.code).toBe('invalid_input');
    const created = await http().post('/api/expenses').set(as('usr_admin')).send({ ...expense, date: '2026-10-20' }).expect(201);
    await http().delete(`/api/expenses/${created.body.id}`).set(as('usr_admin')).expect(204);
  });

  it("kirim: kasr narx — invalid_price (500 emas); tasdiqlash / rad etish — 200", async () => {
    const purchase = await http()
      .post('/api/purchases')
      .set(as('usr_supplier'))
      .send({ warehouseId: 'wh_central', items: [{ ingredientId: 'tomato', qty: 2.5 }] })
      .expect(201);
    const bad = await http()
      .post(`/api/purchases/${purchase.body.id}/approve`)
      .set(as('usr_admin'))
      .send({ prices: { tomato: 1.5 } })
      .expect(400);
    expect(bad.body.code).toBe('invalid_price');
    const approved = await http().post(`/api/purchases/${purchase.body.id}/approve`).set(as('usr_admin')).send({}).expect(200);
    expect(approved.body.status).toBe('approved');
    // ta'minotchi tasdiqlay olmaydi
    await http().post(`/api/purchases/${purchase.body.id}/reject`).set(as('usr_supplier')).expect(403);
  });

  it("ombor mahsuloti narxi: admin qo'shishda va tahrirda kiritadi; ta'minotchi — yo'q; keyingi kirimga yoziladi", async () => {
    const body = { name: { uz: 'Yalpiz', ru: '', en: '' }, group: 'vegetables', unit: 'kg', active: true };
    const created = await http().post('/api/ingredients').set(as('usr_admin')).send({ ...body, lastPrice: 40_000 }).expect(201);
    expect(created.body.lastPrice).toBe(40_000);
    const id = created.body.id;

    const edited = await http().patch(`/api/ingredients/${id}`).set(as('usr_admin')).send({ ...body, lastPrice: 42_000 }).expect(200);
    expect(edited.body.lastPrice).toBe(42_000);
    // narx yuborilmasa — o'zgarmaydi (ta'minotchi nom / guruhni tahrirlay oladi)
    const renamed = await http()
      .patch(`/api/ingredients/${id}`)
      .set(as('usr_supplier'))
      .send({ ...body, name: { uz: 'Yalpiz (yangi)', ru: '', en: '' } })
      .expect(200);
    expect(renamed.body).toMatchObject({ lastPrice: 42_000, name: { uz: 'Yalpiz (yangi)' } });

    const supplier = await http().patch(`/api/ingredients/${id}`).set(as('usr_supplier')).send({ ...body, lastPrice: 1 }).expect(403);
    expect(supplier.body.code).toBe('forbidden');
    await http().post('/api/ingredients').set(as('usr_supplier')).send({ ...body, lastPrice: 1 }).expect(403);
    const fractional = await http().patch(`/api/ingredients/${id}`).set(as('usr_admin')).send({ ...body, lastPrice: 1.5 }).expect(400);
    expect(fractional.body.code).toBe('invalid_price');

    const purchase = await http()
      .post('/api/purchases')
      .set(as('usr_supplier'))
      .send({ warehouseId: 'wh_central', items: [{ ingredientId: id, qty: 2 }] })
      .expect(201);
    expect(purchase.body.items[0].price).toBe(42_000);

    const cleared = await http().patch(`/api/ingredients/${id}`).set(as('usr_admin')).send({ ...body, lastPrice: null }).expect(200);
    expect(cleared.body.lastPrice).toBeNull();
  });

  it("filial: `workHours` yuborilmasa o'zgarmaydi, `null` — 24/7", async () => {
    const base = { name: 'Yunusobod', address: '', phone: '', active: true };
    await http()
      .patch('/api/branches/br_yunusobod')
      .set(as('usr_admin'))
      .send({ ...base, workHours: { open: '10:00', close: '23:00' } })
      .expect(200);
    const kept = await http().patch('/api/branches/br_yunusobod').set(as('usr_admin')).send(base).expect(200);
    expect(kept.body.workHours).toEqual({ open: '10:00', close: '23:00' });
    const reset = await http().patch('/api/branches/br_yunusobod').set(as('usr_admin')).send({ ...base, workHours: null }).expect(200);
    expect(reset.body.workHours).toBeNull();
  });

  it("mobil: forma xatosi filial tanlashdan oldin; ochiq filial yo'q — branch_closed", async () => {
    // asosiy demo bazada smenalar yo'q — hamma filial yopiq
    await app.get(DataSource).query(`UPDATE shifts SET "closedAt" = now() WHERE "closedAt" IS NULL`);
    const order = {
      type: 'delivery',
      items: [{ productId: 'burger-classic', qty: 1 }],
      online: { platform: 'android', name: 'Aziz', phone: '+998 9', address: 'Uy', payment: 'cash', location: { lat: 41.28, lng: 69.2 } },
    };
    expect((await http().post('/api/mobile/orders').send(order).expect(400)).body.code).toBe('phone_required');
    const noAddress = { ...order, online: { ...order.online, phone: '+998 90 123 45 67', address: ' ' } };
    expect((await http().post('/api/mobile/orders').send(noAddress).expect(400)).body.code).toBe('address_required');
    const valid = { ...order, online: { ...order.online, phone: '+998 90 123 45 67' } };
    expect((await http().post('/api/mobile/orders').send(valid).expect(409)).body.code).toBe('branch_closed');
  });

  it("TV va kiosk — PINsiz, kalitsiz (filial so'rovda); faol bo'lmagan filial — 404", async () => {
    await http().get('/api/tv/queue?branchId=br_chilonzor').expect(200);
    expect((await http().get('/api/tv/queue').expect(400)).body.code).toBe('branch_required');
    await http().get('/api/tv/queue?branchId=br_none').expect(404);

    const kiosk = { type: 'takeaway', items: [{ productId: 'burger-classic', qty: 1 }], payment: null };
    const created = await http().post('/api/kiosk/orders').send({ ...kiosk, branchId: 'br_chilonzor' }).expect(201);
    expect(created.body).toMatchObject({ branchId: 'br_chilonzor', status: 'pending' });
    expect((await http().post('/api/kiosk/orders').send(kiosk).expect(400)).body.code).toBe('invalid_input');

    await http().get('/api/menu?branchId=br_chilonzor').expect(200);
    await app.get(DataSource).query(`UPDATE branches SET active = false WHERE id = 'br_yunusobod'`);
    await http().get('/api/menu?branchId=br_yunusobod').expect(404);
    await http().get('/api/tv/queue?branchId=br_yunusobod').expect(404);
    await http().post('/api/kiosk/orders').send({ ...kiosk, branchId: 'br_yunusobod' }).expect(404);
    await app.get(DataSource).query(`UPDATE branches SET active = true WHERE id = 'br_yunusobod'`);
  });

  it("kassa menyusi (`all=true`): sotilmaydigan taom ham `price: null` bilan; oddiy menyuda — yo'q", async () => {
    const all = (await http().get('/api/menu?branchId=br_yunusobod&all=true').expect(200)).body;
    expect(all.products.find((p: { id: string }) => p.id === 'hotdog-kimchi')).toMatchObject({ price: null });
    const sellable = (await http().get('/api/menu?branchId=br_yunusobod').expect(200)).body;
    expect(sellable.products.some((p: { id: string }) => p.id === 'hotdog-kimchi')).toBe(false);
  });

  it("xodimlar ro'yxati: admin va ta'minotchi (muallif ismlari uchun); kassir — yo'q", async () => {
    const list = await http().get('/api/users').set(as('usr_supplier')).expect(200);
    expect(list.body.some((u: { id: string }) => u.id === 'usr_admin')).toBe(true);
    expect(list.body[0].pinHash).toBeUndefined();
    await http().get('/api/users').set(as('usr_cashier_c1')).expect(403);
  });

  it("buyurtmalar ro'yxati: to'lov (aralash — ikkala turda), kassir, raqam filtrlari va filtrlangan hamma bo'yicha jami", async () => {
    await http().post('/api/shifts/current').set(as('usr_cashier_c1')).expect(200);
    const sell = (body: object) => http().post('/api/orders').set(as('usr_cashier_c1')).send(body).expect(201);
    const items = [{ productId: 'burger-classic', qty: 1 }];
    const cash = (await sell({ type: 'dine_in', items, payment: 'cash' })).body;
    const mixed = (await sell({ type: 'dine_in', items, payment: 'cash', split: { cash: 12_000, card: 20_000 } })).body;
    const card = (await sell({ type: 'takeaway', items, payment: 'card' })).body;
    await http().post(`/api/orders/${card.id}/cancel`).set(as('usr_cashier_c1')).expect(200);

    const from = new Date(Date.now() - 3_600_000).toISOString();
    const byCard = (await http().get(`/api/orders?payment=card&from=${from}`).set(as('usr_admin')).expect(200)).body;
    expect(byCard.items.map((o: { id: string }) => o.id).sort()).toEqual([mixed.id, card.id].sort());
    expect(byCard.summary).toEqual({
      count: 2,
      paid: { count: 1, amount: 32_000 },
      cancelled: { count: 1, amount: 32_000 },
      pending: { count: 0, amount: 0 },
    });
    const byNumber = (await http().get(`/api/orders?number=${cash.number}&cashierId=usr_cashier_c1&from=${from}`).set(as('usr_admin')).expect(200)).body;
    expect(byNumber.items.map((o: { id: string }) => o.id)).toEqual([cash.id]);
  });

  it('smenalar: oraliq bilan kesishgani, ochiqlari tepada, jami (soni, ochiq, tushum, naqd)', async () => {
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const page = (await http().get(`/api/shifts?from=${from}&to=${to}`).set(as('usr_admin')).expect(200)).body;
    expect(page.items[0].closedAt).toBeNull();
    expect(page.summary.open).toBeGreaterThanOrEqual(1);
    expect(page.summary.count).toBe(page.total);
    expect(page.summary.revenue).toBe(
      page.items.reduce((sum: number, shift: { summary: { total: number } }) => sum + shift.summary.total, 0),
    );
  });

  it("ombor harakatlari: hujjat raqami va ko'chirishda ikkinchi ombor; hisobot — birinchi buyurtma kuni", async () => {
    const transfer = await http()
      .post('/api/transfers')
      .set(as('usr_supplier'))
      .send({ fromWarehouseId: 'wh_central', toWarehouseId: 'wh_chilonzor', items: [{ ingredientId: 'tomato', qty: 1 }] })
      .expect(201);
    const moves = (await http().get(`/api/movements?refId=${transfer.body.id}`).set(as('usr_supplier')).expect(200)).body;
    const out = moves.items.find((m: { kind: string }) => m.kind === 'transfer_out');
    const into = moves.items.find((m: { kind: string }) => m.kind === 'transfer_in');
    expect(out).toMatchObject({ refNumber: transfer.body.number, refWarehouseId: 'wh_chilonzor', warehouseId: 'wh_central' });
    expect(into).toMatchObject({ refNumber: transfer.body.number, refWarehouseId: 'wh_central' });

    const overview = (await http().get('/api/reports/overview').set(as('usr_admin')).expect(200)).body;
    expect(overview.firstOrderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("qabul muddati: yangi filial taomni sotmasa — o'tkazilmaydi (no_branch); mijozga `routedAt` boradi", async () => {
    const now = new Date();
    const shifts = app.get(ShiftsService);
    await shifts.openOrResume('usr_cashier_c1', 'br_chilonzor', now);
    await shifts.openOrResume('usr_cashier_y1', 'br_yunusobod', now);
    const orders = app.get(OrdersService);
    const online = {
      platform: 'ios' as const,
      name: 'Malika',
      phone: '+998 93 555 12 34',
      address: 'Chilonzor 9',
      payment: 'cash' as const,
      location: { lat: 41.28, lng: 69.2 },
    };
    // kimchi hot-dog Yunusobodda vaqtincha sotilmaydi (demo)
    const kimchi = await orders.createByMobile({ type: 'delivery', items: [{ productId: 'hotdog-kimchi', qty: 1 }], online }, now);
    const burger = await orders.createByMobile({ type: 'delivery', items: [{ productId: 'burger-classic', qty: 1 }], online }, now);
    expect(kimchi.order.branchId).toBe('br_chilonzor');
    expect(new Date(kimchi.order.routedAt).getTime()).toBe(now.getTime());

    await orders.expirePendingMobile(new Date(now.getTime() + 6 * 60_000));
    expect(await orders.track(kimchi.order.id, kimchi.trackingToken)).toMatchObject({ status: 'cancelled', cancelReason: 'no_branch' });
    const moved = await orders.track(burger.order.id, burger.trackingToken);
    // narx va summa o'zgarmaydi — mijoz shu summaga rozi bo'lgan
    expect(moved).toMatchObject({ status: 'pending', branchId: 'br_yunusobod', fromBranchId: 'br_chilonzor', transferCount: 1, total: 32_000 });
  });
});
