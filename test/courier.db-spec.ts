import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import type { AuthUser } from '../src/auth/auth.types';
import { BranchesService } from '../src/branches/branches.service';
import type { LatLng } from '../src/common/types';
import { CourierService } from '../src/courier/courier.service';
import { seedDemo } from './fixtures/demo';
import { planRoute } from '../src/domain/courier-route';
import { Order } from '../src/orders/order.entity';
import { customerOrderView } from '../src/orders/order.views';
import { OrdersService } from '../src/orders/orders.service';
import { UsersService } from '../src/users/users.service';
import { actor, createTestApp, expectCode } from './test-app';

/**
 * Kuryer (2026-10-27): "Ishdaman", istalgan filialdan olish (bir vaqtda bitta filialdan, soni cheklanmagan), yo'lga
 * chiqqanda server tartibni beradi (mijozlar o'rtacha eng kam kutadi), yetkazildi / yetkazib bo'lmadi, kassir buyurtmani
 * kuryerdan qaytarib oladi. Buyurtma `status` i o'zgarmaydi — kuryer bosqichlari alohida maydonlarda.
 */

const now = new Date('2026-10-23T12:00:00');
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const C = 'br_chilonzor';
const Y = 'br_yunusobod';
/** Chilonzor hududidagi uylar */
const P1 = { lat: 41.285, lng: 69.205 };
const P2 = { lat: 41.26, lng: 69.22 };
const P3 = { lat: 41.295, lng: 69.175 };
const IN_YUNUSOBOD = { lat: 41.36, lng: 69.29 };
/** hech qaysi hududda emas — eng yaqin ochiq filial (Yunusobod), narxsiz */
const CENTER = { lat: 41.3111, lng: 69.2797 };

const bobur = actor('usr_courier_1', 'courier');
const otabek = actor('usr_courier_2', 'courier');
const cashierOf: Record<string, AuthUser> = {
  [C]: actor('usr_cashier_c1', 'cashier', C),
  [Y]: actor('usr_cashier_y1', 'cashier', Y),
};
const kitchenOf: Record<string, AuthUser> = {
  [C]: actor('usr_kitchen_c1', 'kitchen', C),
  [Y]: actor('usr_kitchen_y1', 'kitchen', Y),
};

describe('kuryer: olish, yetkazish tartibi, yetkazildi / qaytdi', () => {
  let app: INestApplication;
  let em: EntityManager;
  let orders: OrdersService;
  let courier: CourierService;
  let branches: BranchesService;
  let users: UsersService;
  let auth: AuthService;

  beforeAll(async () => {
    app = await createTestApp();
    em = app.get(DataSource).manager;
    orders = app.get(OrdersService);
    courier = app.get(CourierService);
    branches = app.get(BranchesService);
    users = app.get(UsersService);
    auth = app.get(AuthService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await seedDemo(app, { activity: true }, now);
    await courier.setDuty(bobur, true);
    await courier.setDuty(otabek, true);
  });

  /** Mobil dostavka → kassir qabul qildi → (ixtiyoriy) oshpaz yordamchisi "Tayyor". */
  async function delivery(point: LatLng, ready = true, at = now): Promise<Order> {
    const { order } = await orders.createByMobile(
      {
        type: 'delivery',
        items: [{ productId: 'burger-classic', qty: 1 }],
        online: { platform: 'android', name: 'Mijoz', phone: '+998 90 000 00 00', address: 'Uy', payment: 'cash', location: point },
      },
      at,
    );
    await orders.confirm(order.id, cashierOf[order.branchId], {}, at);
    if (ready) await orders.markReady(order.id, kitchenOf[order.branchId], at);
    return em.findOneByOrFail(Order, { id: order.id });
  }
  const find = (id: string) => em.findOneByOrFail(Order, { id });
  const availableIds = async (user = bobur) => (await courier.available(user, now)).map((o) => o.id);

  it("dostavka narxi buyurtmada saqlanadi: hudud ichida — hudud narxi, tashqarida — null; mijoz ko'radi", async () => {
    const inZone = await delivery(P1);
    expect(inZone).toMatchObject({ branchId: C, deliveryFee: 10_000, courierId: null, departedAt: null });
    const outside = await delivery(CENTER);
    expect(outside).toMatchObject({ branchId: Y, deliveryFee: null });
    const { order } = await orders.createByMobile(
      { type: 'takeaway', branchId: C, items: [{ productId: 'burger-classic', qty: 1 }], online: { platform: 'android', name: 'M', phone: '+998 90 000 00 01', payment: 'cash' } },
      now,
    );
    expect(order).toMatchObject({ deliveryFee: null, departedAt: null, deliveredAt: null, returnedAt: null });
  });

  it("\"Ishdaman\" o'chiq — olmaydi; yoqilgach oladi; boshqa kuryer ololmaydi; takroriy bosish xato emas", async () => {
    const order = await delivery(P1, false);
    expect(await availableIds()).toContain(order.id);

    await courier.setDuty(bobur, false);
    expect((await courier.available(bobur, now)).find((o) => o.id === order.id)?.blocked).toBe('off_duty');
    await expectCode('off_duty', () => courier.take(bobur, order.id, now));

    await courier.setDuty(bobur, true);
    // hali tayyorlanmoqda — olish mumkin (kuryer filialda kutadi)
    const mine = await courier.take(bobur, order.id, later(1));
    expect(mine.active.map((o) => o.id)).toEqual([order.id]);
    expect(await find(order.id)).toMatchObject({ courierId: bobur.id, takenAt: later(1), status: 'preparing' });
    expect(await courier.take(bobur, order.id, later(2))).toEqual(mine);
    await expectCode('already_taken', () => courier.take(otabek, order.id, now));
    expect(await availableIds(otabek)).not.toContain(order.id);
  });

  it("bir vaqtda bitta filialdan: qo'lda Chilonzor — Yunusobodnikini ololmaydi; Chilonzor ikkinchisi — yo'lga qo'shimchasi bilan", async () => {
    const c1 = await delivery(P1);
    const c2 = await delivery(P2);
    const y1 = await delivery(IN_YUNUSOBOD);
    expect(y1.branchId).toBe(Y);
    await courier.take(bobur, c1.id, now);

    const list = await courier.available(bobur, now);
    const byId = new Map(list.map((o) => [o.id, o]));
    expect(byId.get(y1.id)?.blocked).toBe('other_branch');
    expect(byId.get(c2.id)).toMatchObject({ blocked: null, payment: 'cash', deliveryFee: 10_000, address: 'Uy' });
    expect(byId.get(c2.id)?.extraKm).toBeGreaterThan(0);
    expect(byId.get(c2.id)?.distanceKm).toBeGreaterThan(0);
    // mijoz ismi va telefoni "Yangi" ro'yxatida yo'q
    expect(byId.get(c2.id)).not.toHaveProperty('online');

    await expectCode('other_branch', () => courier.take(bobur, y1.id, now));
    await courier.take(bobur, c2.id, now);
    // boshqa kuryerga Yunusobodniki ochiq
    expect((await courier.available(otabek, now)).find((o) => o.id === y1.id)?.blocked).toBeNull();
  });

  it("yo'lga chiqish: hammasi tayyor bo'lishi shart; tartib — mijozlar o'rtacha eng kam kutadigani; mijozga \"yo'lda\"", async () => {
    const a = await delivery(P1);
    const b = await delivery(P2);
    const c = await delivery(P3, false);
    for (const o of [a, b, c]) await courier.take(bobur, o.id, now);

    await expectCode('not_ready', () => courier.depart(bobur, now));
    await orders.markReady(c.id, kitchenOf[C], now);

    const result = await courier.depart(bobur, later(5));
    const branch = await branches.get(em, C);
    const expected = planRoute(branch.location, [a, b, c].map((o) => ({ id: o.id, point: o.online!.location! })));
    expect(result.active.map((o) => o.id)).toEqual(expected.map((s) => s.id));
    expect(result.active.map((o) => o.courierSeq)).toEqual([1, 2, 3]);
    expect(result.active[0].courierLegKm).toBeCloseTo(expected[0].legKm, 2);
    for (const o of result.active) expect(o.departedAt).toEqual(later(5));

    // mijoz: status o'zgarmaydi (ready), lekin "yo'lda"; kuryer kimligi va navbati ko'rinmaydi
    const customer = customerOrderView(await find(a.id));
    expect(customer).toMatchObject({ status: 'ready', departedAt: later(5), deliveredAt: null });
    expect(customer).not.toHaveProperty('courierId');
    expect(customer).not.toHaveProperty('courierSeq');
    // yo'lda — oshpaz yordamchisi "Qaytarish" qila olmaydi, kuryer yangi buyurtma ololmaydi
    await expectCode('invalid_status', () => orders.reopen(a.id, kitchenOf[C], now));
    const d = await delivery(P2);
    await expectCode('courier_busy', () => courier.take(bobur, d.id, now));
    expect((await courier.available(bobur, now)).find((o) => o.id === d.id)?.blocked).toBe('courier_busy');
    await expectCode('empty_order', () => courier.depart(otabek, now));
  });

  it("yetkazildi → qolganlari shu manzildan qayta tartiblanadi; bugungi ro'yxatda; hammasi tugagach yana oladi", async () => {
    const a = await delivery(P1);
    const b = await delivery(P2);
    const c = await delivery(P3);
    for (const o of [a, b, c]) await courier.take(bobur, o.id, now);
    const first = (await courier.depart(bobur, now)).active;

    const afterOne = await courier.deliver(bobur, first[0].id, later(10));
    expect(await find(first[0].id)).toMatchObject({ deliveredAt: later(10), status: 'ready', courierSeq: 1 });
    const rest = first.slice(1);
    const expected = planRoute(
      first[0].online!.location,
      rest.map((o) => ({ id: o.id, point: o.online!.location! })),
    );
    expect(afterOne.active.map((o) => o.id)).toEqual(expected.map((s) => s.id));
    expect(afterOne.active.map((o) => o.courierSeq)).toEqual([2, 3]);
    expect(afterOne.done.map((o) => o.id)).toEqual([first[0].id]);

    await expectCode('invalid_status', () => courier.deliver(bobur, first[0].id, now));
    await expectCode('forbidden', () => courier.deliver(otabek, afterOne.active[0].id, now));
    // yetkazilganni bekor qilib bo'lmaydi
    await expectCode('invalid_status', () => orders.cancel(first[0].id, cashierOf[C], now));

    await courier.deliver(bobur, afterOne.active[0].id, later(15));
    const last = await courier.deliver(bobur, afterOne.active[1].id, later(20));
    expect(last.active).toEqual([]);
    expect(last.done).toHaveLength(3);
    expect((await courier.me(bobur)).branchId).toBeNull();
    // qo'l bo'sh — boshqa filialdan ham oladi
    const y = await delivery(IN_YUNUSOBOD);
    await courier.take(bobur, y.id, now);
  });

  it("yetkazib bo'lmadi → sabab bilan qaytadi; kassir kuryerdan oladi → yana \"Yangi\" ro'yxatida", async () => {
    const a = await delivery(P1);
    const b = await delivery(P2);
    await courier.take(bobur, a.id, now);
    await courier.take(bobur, b.id, now);
    const route = (await courier.depart(bobur, now)).active;

    const result = await courier.returnOrder(bobur, route[0].id, { reason: 'no_answer', note: ' 3 marta qo\'ng\'iroq ' }, later(8));
    expect(await find(route[0].id)).toMatchObject({
      returnedAt: later(8),
      returnReason: 'no_answer',
      returnNote: "3 marta qo'ng'iroq",
      status: 'ready',
    });
    expect(result.active.map((o) => o.id)).toEqual([route[1].id]);
    expect(result.active[0].courierSeq).toBe(2);
    expect(result.done.map((o) => o.id)).toEqual([route[0].id]);

    // boshqa filial kassiri — yo'q; o'z filiali kassiri — kuryerdan oladi
    await expectCode('forbidden', () => orders.releaseCourier(route[0].id, cashierOf[Y]));
    const released = await orders.releaseCourier(route[0].id, cashierOf[C]);
    expect(released).toMatchObject({ courierId: null, departedAt: null, returnedAt: null, returnReason: null, courierSeq: null });
    expect(await availableIds(otabek)).toContain(route[0].id);
    // kuryeri yo'q buyurtmani — yo'q
    await expectCode('invalid_status', () => orders.releaseCourier(route[0].id, cashierOf[C]));
  });

  it("kassaning \"Dostavka\" ro'yxati: kuryer kutayotgan, olingan, yo'ldagi va qaytgan; yetkazilgani, qabul qilinmagani va boshqa filialniki — yo'q", async () => {
    const waiting = await delivery(P1, false, later(1));
    const taken = await delivery(P2, true, later(2));
    const delivered = await delivery(P3, true, later(3));
    const returned = await delivery(P1, true, later(4));
    const other = await delivery(IN_YUNUSOBOD, true, later(5));
    const { order: notAccepted } = await orders.createByMobile(
      {
        type: 'delivery',
        items: [{ productId: 'burger-classic', qty: 1 }],
        online: { platform: 'android', name: 'M', phone: '+998 90 000 00 02', address: 'Uy', payment: 'cash', location: P2 },
      },
      later(5),
    );
    await courier.take(otabek, taken.id, later(6));
    await courier.take(bobur, delivered.id, later(6));
    await courier.take(bobur, returned.id, later(6));
    await courier.depart(bobur, later(7));
    await courier.deliver(bobur, delivered.id, later(8));
    await courier.returnOrder(bobur, returned.id, { reason: 'refused' }, later(9));

    // demo tarixida ham dostavka bo'lishi mumkin — faqat shu yerda yaratilganlar
    const mine = new Set([waiting, taken, delivered, returned, other, notAccepted].map((o) => o.id));
    const list = (await orders.deliveries(C, later(10))).filter((o) => mine.has(o.id));
    expect(list.map((o) => o.id)).toEqual([waiting.id, taken.id, returned.id]);
    expect(list[1]).toMatchObject({ courierId: otabek.id, departedAt: null });
    expect(list[2]).toMatchObject({ courierId: bobur.id, returnReason: 'refused', returnNote: '' });
    // admin / kassa: kuryerlar holati — Otabek qo'lida 1 ta (Chilonzor, hali yo'lda emas); Bobur hammasini tugatgan
    const statuses = await users.couriers();
    expect(statuses.find((c) => c.id === otabek.id)).toMatchObject({ onDuty: true, orders: 1, branchId: C, departed: false });
    expect(statuses.find((c) => c.id === bobur.id)).toMatchObject({ onDuty: true, orders: 0, branchId: null, departed: false });
    // 12 soatdan eskisi — kuryer tizimidan oldingi tarix, ro'yxatni to'ldirmaydi
    expect(await orders.deliveries(C, later(13 * 60))).toEqual([]);
  });

  it("admin: kuryer — email (kichik harfda, takrorlanmaydi) va parol; bo'sh parol eskisini qoldiradi; rol almashsa yangisi majburiy", async () => {
    const save = (input: Parameters<UsersService['save']>[0]) => users.save(input, 'usr_admin', now);
    const base = { name: 'Sanjar', surname: 'Komilov', role: 'courier' as const, branchId: null, active: true };
    await expectCode('invalid_email', () => save({ ...base, email: 'sanjar', password: 'secret12' }));
    await expectCode('invalid_email', () => save({ ...base, email: 'san jar@gmail.com', password: 'secret12' }));
    await expectCode('invalid_password', () => save({ ...base, email: 'sanjar@gmail.com', password: '1234567' }));
    await expectCode('email_taken', () => save({ ...base, email: 'BOBUR@gmail.com', password: 'secret12' }));
    await expectCode('surname_required', () => save({ ...base, surname: '  ', email: 'sanjar@gmail.com', password: 'secret12' }));

    const sanjar = await save({ ...base, email: ' Sanjar.K@Gmail.com ', password: 'secret12' });
    expect(sanjar).toMatchObject({ email: 'sanjar.k@gmail.com', surname: 'Komilov', branchId: null });
    expect((await auth.passwordLogin('courier', 'sanjar.k@gmail.com', 'secret12', now)).user.id).toBe(sanjar.id);
    await save({ ...base, id: sanjar.id, name: 'Sanjar K.', email: 'sanjar.k@gmail.com', password: '' });
    expect((await auth.passwordLogin('courier', 'SANJAR.K@gmail.com', 'secret12', now)).user.name).toBe('Sanjar K.');
    // admin kirishi orqali kuryer kira olmaydi
    await expectCode('wrong_login', () => auth.passwordLogin('admin', 'sanjar.k@gmail.com', 'secret12', now));

    // kassir → kuryer: parolsiz bo'lmaydi; kuryer → kassir: PIN'siz bo'lmaydi, email tozalanadi
    await expectCode('invalid_password', () =>
      save({ id: 'usr_cashier_c2', name: 'Sardor', surname: 'Aliyev', role: 'courier', branchId: null, email: 'sardor@gmail.com', active: true }),
    );
    await expectCode('invalid_pin', () => save({ ...base, id: sanjar.id, role: 'cashier', branchId: C, pin: '' }));
    const cashier = await save({ ...base, id: sanjar.id, role: 'cashier', branchId: C, pin: '9876' });
    expect(cashier.email).toBeNull();
    await expectCode('wrong_login', () => auth.passwordLogin('courier', 'sanjar.k@gmail.com', 'secret12', now));
  });

  it("yo'lga chiqmasdan qaytarib berish; bekor qilingan buyurtma kuryer ro'yxatidan tushadi", async () => {
    const a = await delivery(P1);
    const b = await delivery(P2);
    await courier.take(bobur, a.id, now);
    await courier.take(bobur, b.id, now);

    const afterRelease = await courier.release(bobur, a.id, now);
    expect(afterRelease.active.map((o) => o.id)).toEqual([b.id]);
    expect(await availableIds(otabek)).toContain(a.id);
    await expectCode('forbidden', () => courier.release(otabek, b.id, now));

    await orders.cancel(b.id, cashierOf[C], now);
    expect((await courier.orders(bobur, now)).active).toEqual([]);
    expect(await availableIds()).not.toContain(b.id);
  });

  describe('HTTP va socket', () => {
    let url: string;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      await app.listen(0);
      url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));

    const login = async (userId: string, pin: string) =>
      (await request(app.getHttpServer()).post('/api/auth/login').send({ userId, pin }).expect(200)).body.token as string;
    const courierLogin = (email: string, password: string) =>
      request(app.getHttpServer()).post('/api/auth/courier-login').send({ email, password });

    it("kuryer kirishi: email va parol (katta-kichik harf farqsiz); ismlari ochiq ro'yxatda yo'q; PIN kirishi — yo'q", async () => {
      const couriers = await request(app.getHttpServer()).get('/api/auth/staff?role=courier').expect(200);
      expect(couriers.body).toEqual([]);
      const all = await request(app.getHttpServer()).get('/api/auth/staff').expect(200);
      expect(all.body.some((u: { role: string }) => u.role === 'courier')).toBe(false);

      const ok = await courierLogin(' Bobur@Gmail.com ', 'bobur2222').expect(200);
      expect(ok.body).toMatchObject({
        user: { id: 'usr_courier_1', name: 'Bobur', surname: 'Ergashev', role: 'courier', branchId: null, email: 'bobur@gmail.com' },
        shift: null,
      });
      expect(typeof ok.body.token).toBe('string');
      expect((await courierLogin('bobur@gmail.com', 'otabek3333').expect(401)).body.code).toBe('wrong_login');
      // yo'q email — xuddi shu javob (qaysi email borligi bilinmasin)
      expect((await courierLogin('nobody@gmail.com', 'bobur2222').expect(401)).body.code).toBe('wrong_login');
      // kuryer PIN ekrani orqali kira olmaydi (paroli to'g'ri bo'lsa ham)
      await request(app.getHttpServer()).post('/api/auth/login').send({ userId: 'usr_courier_1', pin: 'bobur2222' }).expect(400);
      await request(app.getHttpServer()).post('/api/auth/login').send({ userId: 'usr_courier_1', pin: '22222222' }).expect(403);
      // admin emaili kuryer kirishida — yo'q
      expect((await courierLogin('admin@gmail.com', '123456789').expect(401)).body.code).toBe('wrong_login');
    });

    it("faqat kuryer: /courier/* — kassirga 403; kuryer — filialsiz", async () => {
      const cashier = await login('usr_cashier_c1', '1234');
      await request(app.getHttpServer()).get('/api/courier/orders').set('Authorization', `Bearer ${cashier}`).expect(403);
      // kassaning "Dostavka" ro'yxati — kassirga o'z filiali, kuryerga yo'q
      const own = await request(app.getHttpServer()).get('/api/orders/delivery').set('Authorization', `Bearer ${cashier}`).expect(200);
      expect(Array.isArray(own.body)).toBe(true);
      // kuryerlar va holati kassirga — himoyalangan ro'yxatdan (email, parol xeshi yo'q)
      const names = await request(app.getHttpServer()).get('/api/users/couriers').set('Authorization', `Bearer ${cashier}`).expect(200);
      expect(names.body.map((c: { id: string; name: string; surname: string }) => [c.id, c.name, c.surname])).toEqual([
        ['usr_courier_1', 'Bobur', 'Ergashev'],
        ['usr_courier_2', 'Otabek', 'Saidov'],
      ]);
      expect(Object.keys(names.body[0]).sort()).toEqual(['active', 'branchId', 'departed', 'id', 'name', 'onDuty', 'orders', 'surname']);
      expect(names.body[0]).toMatchObject({ active: true, onDuty: true, orders: 0, branchId: null, departed: false });

      const token = (await courierLogin('bobur@gmail.com', 'bobur2222').expect(200)).body.token as string;
      await request(app.getHttpServer()).get('/api/orders/delivery').set('Authorization', `Bearer ${token}`).expect(403);
      await request(app.getHttpServer()).get('/api/users/couriers').set('Authorization', `Bearer ${token}`).expect(403);
      const me =await request(app.getHttpServer()).get('/api/courier/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(me.body).toMatchObject({ user: { id: 'usr_courier_1', role: 'courier', branchId: null }, onDuty: true, branchId: null });
      const off = await request(app.getHttpServer())
        .put('/api/courier/duty')
        .set('Authorization', `Bearer ${token}`)
        .send({ onDuty: false })
        .expect(200);
      expect(off.body.onDuty).toBe(false);
      await request(app.getHttpServer())
        .post('/api/courier/orders/x/return')
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'lost' })
        .expect(400);
    });

    it("socket: kuryer `couriers` va o'z xonasiga ulanadi; olinganda xabar keladi", async () => {
      const token = (await courierLogin('bobur@gmail.com', 'bobur2222').expect(200)).body.token as string;
      const socket = io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      const rooms = await new Promise<string[]>((resolve) => socket.on('ready', (data: { rooms: string[] }) => resolve(data.rooms)));
      expect(rooms).toEqual(['couriers', 'courier:usr_courier_1']);

      const order = await delivery(P1);
      const events: { id: string; courierId: string | null; online?: unknown }[] = [];
      socket.on('order', (data: { id: string; courierId: string | null }) => events.push(data));
      await courier.take(bobur, order.id, now);
      await new Promise((resolve) => setTimeout(resolve, 300));
      // `couriers` — belgi (mijoz ma'lumotisiz), o'z xonasi — to'liq ko'rinish
      expect(events.some((e) => e.id === order.id && e.courierId === bobur.id && e.online === undefined)).toBe(true);
      expect(events.some((e) => e.id === order.id && e.online !== undefined)).toBe(true);
    });
  });
});
