import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashPin } from '../src/auth/pin';
import { Branch } from '../src/branches/branch.entity';
import { BranchesService } from '../src/branches/branches.service';
import { Warehouse } from '../src/branches/warehouse.entity';
import { Category } from '../src/menu/category.entity';
import { Product } from '../src/menu/product.entity';
import { OrdersService } from '../src/orders/orders.service';
import { User } from '../src/users/user.entity';
import { UsersService } from '../src/users/users.service';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { createTestApp, truncateAll } from './test-app';

/**
 * Socket.IO va PINsiz kirish yo'llari (HTTP orqali, haqiqiy server): kassa ulanganmi → filial online holati, xonalar
 * (TV ga faqat raqam, mijozga xodim ma'lumotisiz), qurilma kaliti, mobil kuzatish tokeni, 5 daqiqalik qabul muddati.
 */

const B = 'br_rt';
const ZONE = [
  { lat: 41.0, lng: 69.0 },
  { lat: 41.0, lng: 69.1 },
  { lat: 41.1, lng: 69.1 },
  { lat: 41.1, lng: 69.0 },
];
const INSIDE = { lat: 41.05, lng: 69.05 };

async function seedFixtures(dataSource: DataSource) {
  const em = dataSource.manager;
  const now = new Date();
  await em.insert(Branch, {
    id: B,
    name: 'RT',
    address: '',
    phone: '',
    active: true,
    createdAt: now,
    location: { lat: 41.05, lng: 69.05 },
    deliveryZone: ZONE,
    deliveryFee: 5000,
    fallbackBranchId: null,
    onlineEnabled: true,
    workHours: null,
  });
  await em.insert(Warehouse, { id: 'wh_rt', name: 'RT ombori', kind: 'branch', branchId: B });
  const pinHash = await hashPin('1234');
  await em.insert(User, [
    { id: 'usr_c', name: 'Kassir', role: 'cashier', branchId: B, pinHash, active: true, createdAt: now },
    { id: 'usr_k', name: 'Oshpaz yordamchisi', role: 'kitchen', branchId: B, pinHash, active: true, createdAt: now },
  ]);
  await em.insert(Ingredient, {
    id: 'bun',
    name: { uz: 'Non', ru: 'Хлеб', en: 'Bun' },
    group: 'bread',
    unit: 'pcs',
    lastPrice: 1000,
    active: true,
  });
  await em.insert(Category, { id: 'cat', name: { uz: 'Burger', ru: '', en: '' }, image: '', icon: '', sortOrder: 1, active: true });
  await em.insert(Product, {
    id: 'burger',
    categoryId: 'cat',
    name: { uz: 'Burger', ru: 'Бургер', en: 'Burger' },
    image: '',
    recipe: [{ ingredientId: 'bun', qty: 1 }],
    price: 30000,
    unavailableBranchIds: [],
    sortOrder: 1,
    active: true,
  });
}

/** Ulanadi va `ready` (xonalar) yoki `auth_error` ni kutadi. */
function connect(url: string, auth: Record<string, string>): Promise<{ socket: Socket; rooms: string[] | null }> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { auth, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error('socket: javob yo\'q')), 5000);
    socket.on('ready', (data: { rooms: string[] }) => {
      clearTimeout(timer);
      resolve({ socket, rooms: data.rooms });
    });
    socket.on('auth_error', () => {
      clearTimeout(timer);
      resolve({ socket, rooms: null });
    });
  });
}

function nextEvent<T>(socket: Socket, event = 'order'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event}: kelmadi`)), 5000);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Socket.IO, qurilmalar va mobil buyurtma', () => {
  let app: INestApplication;
  let url: string;
  let branches: BranchesService;
  let orders: OrdersService;
  const sockets: Socket[] = [];
  const later = (ms: number) => new Date(Date.now() + ms);

  const stateAt = async (when: Date) => {
    const branch = await branches.get(app.get(DataSource).manager, B);
    return (await branches.onlineStates([branch], when)).get(B);
  };

  beforeAll(async () => {
    process.env.ONLINE_REQUIRE_KASSA = '1';
    app = await createTestApp();
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    await truncateAll(app);
    await seedFixtures(app.get(DataSource));
    branches = app.get(BranchesService);
    orders = app.get(OrdersService);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    process.env.ONLINE_REQUIRE_KASSA = '0';
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const login = async (userId: string) => (await http().post('/api/auth/login').send({ userId, pin: '1234' }).expect(200)).body;

  it('kassa ekrani ulanmaguncha filial "no_kassa", ulangach — "open"', async () => {
    const cashier = await login('usr_c');
    expect(cashier.shift).toBeTruthy();
    // server endigina ishga tushgan — 60 s kutish; shundan keyingi vaqtga qaraymiz
    expect(await stateAt(later(61_000))).toBe('no_kassa');

    const { socket, rooms } = await connect(url, { token: cashier.token });
    sockets.push(socket);
    expect(rooms).toEqual([`branch:${B}`]);
    expect(await stateAt(later(61_000))).toBe('open');
  });

  it("noto'g'ri kirish ma'lumoti yoki noma'lum filial TV si — auth_error", async () => {
    expect((await connect(url, { token: 'bad' })).rooms).toBeNull();
    expect((await connect(url, { tvBranchId: 'br_none' })).rooms).toBeNull();
    expect((await connect(url, {})).rooms).toBeNull();
  });

  it('TV xonasiga faqat raqam / tur / holat; kassa xonasiga — to\'liq buyurtma', async () => {
    const cashier = await login('usr_c');
    const kitchen = await login('usr_k');
    const tv = await connect(url, { tvBranchId: B });
    sockets.push(tv.socket);
    expect(tv.rooms).toEqual([`tv:${B}`]);
    const staff = await connect(url, { token: kitchen.token });
    sockets.push(staff.socket);

    const tvEvent = nextEvent<Record<string, unknown>>(tv.socket);
    const staffEvent = nextEvent<Record<string, unknown>>(staff.socket);
    const created = await http()
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashier.token}`)
      .send({ type: 'dine_in', items: [{ productId: 'burger', qty: 2 }], payment: 'cash', source: 'kiosk', cashierId: 'usr_k' })
      .expect(201);
    // so'rovdagi `source` / `cashierId` e'tiborga olinmaydi — tokendan
    expect(created.body).toMatchObject({ source: 'cashier', cashierId: 'usr_c', status: 'preparing', total: 60000, number: 1 });

    expect(Object.keys(await tvEvent).sort()).toEqual(['branchId', 'id', 'number', 'preparingAt', 'readyAt', 'status', 'type']);
    expect(await staffEvent).toMatchObject({ id: created.body.id, cashierId: 'usr_c' });

    // "Tayyor" — faqat oshpaz yordamchisi
    const forbidden = await http().post(`/api/orders/${created.body.id}/ready`).set('Authorization', `Bearer ${cashier.token}`).expect(403);
    expect(forbidden.body.code).toBe('forbidden');
    const readyEvent = nextEvent<{ status: string }>(tv.socket);
    await http().post(`/api/orders/${created.body.id}/ready`).set('Authorization', `Bearer ${kitchen.token}`).expect(200);
    expect((await readyEvent).status).toBe('ready');

    const queue = await http().get(`/api/tv/queue?branchId=${B}`).expect(200);
    expect(queue.body.ready.map((o: { id: string }) => o.id)).toEqual([created.body.id]);
  });

  it("kiosk: PINsiz va kalitsiz, filial so'rovda; «kassada to'layman» — kassirni kutadi", async () => {
    const body = { branchId: B, type: 'takeaway', items: [{ productId: 'burger', qty: 1 }], payment: null };
    const kiosk = await http().post('/api/kiosk/orders').send(body).expect(201);
    expect(kiosk.body).toMatchObject({ branchId: B, status: 'pending', payment: null });
    expect(kiosk.body.cashierId).toBeUndefined();
    await http().post('/api/kiosk/orders').send({ ...body, branchId: 'br_none' }).expect(404);
  });

  it('mobil: filialni server tanlaydi, holat faqat token bilan, qabul qilinganda mijozga xabar', async () => {
    const online = { platform: 'android', name: 'Aziz', phone: '+998 90 123 45 67', address: 'Uy 5', payment: 'cash' };
    const noLocation = await http()
      .post('/api/mobile/orders')
      .send({ type: 'delivery', items: [{ productId: 'burger', qty: 1 }], online })
      .expect(400);
    expect(noLocation.body.code).toBe('location_required');

    const created = await http()
      .post('/api/mobile/orders')
      .send({ type: 'delivery', branchId: 'ignored', items: [{ productId: 'burger', qty: 1 }], online: { ...online, location: INSIDE } })
      .expect(201);
    const { order, trackingToken } = created.body;
    expect(order).toMatchObject({ branchId: B, status: 'pending' });
    // mijoz ko'rinishida xodim / ichki maydonlar yo'q
    expect(order.source).toBeUndefined();
    expect(order.trackingTokenHash).toBeUndefined();
    expect(order.online.location).toEqual(INSIDE);
    expect(typeof trackingToken).toBe('string');

    await http().get(`/api/mobile/orders/${order.id}`).expect(404);
    await http().get(`/api/mobile/orders/${order.id}`).set('X-Order-Token', 'wrong').expect(404);
    const tracked = await http().get(`/api/mobile/orders/${order.id}?token=${trackingToken}`).expect(200);
    expect(tracked.body.status).toBe('pending');

    expect((await connect(url, { orderId: order.id, orderToken: 'wrong' })).rooms).toBeNull();
    const mobile = await connect(url, { orderId: order.id, orderToken: trackingToken });
    sockets.push(mobile.socket);
    expect(mobile.rooms).toEqual([`order:${order.id}`]);

    const cashier = await login('usr_c');
    const event = nextEvent<Record<string, unknown>>(mobile.socket);
    const accepted = await http()
      .post(`/api/orders/${order.id}/confirm`)
      .set('Authorization', `Bearer ${cashier.token}`)
      .send({ payment: 'card' })
      .expect(200);
    // mobil buyurtma — mijoz tanlagan to'lov bilan
    expect(accepted.body).toMatchObject({ status: 'preparing', payment: 'cash', cashierId: 'usr_c' });
    const pushed = await event;
    expect(pushed.status).toBe('preparing');
    expect(pushed.cashierId).toBeUndefined();
  });

  it("olib ketish: yopiq filialni tanlab bo'lmaydi; zalda — mumkin emas", async () => {
    const online = { platform: 'ios', name: 'Ali', phone: '+998 90 000 00 00', payment: 'click' };
    const items = [{ productId: 'burger', qty: 1 }];
    await http().post('/api/mobile/orders').send({ type: 'takeaway', branchId: B, items, online }).expect(201);
    const dineIn = await http().post('/api/mobile/orders').send({ type: 'dine_in', branchId: B, items, online }).expect(409);
    expect(dineIn.body.code).toBe('invalid_status');

    const admin = app.get(DataSource).manager;
    await admin.update(Branch, B, { onlineEnabled: false });
    const closed = await http().post('/api/mobile/orders').send({ type: 'takeaway', branchId: B, items, online }).expect(409);
    expect(closed.body.code).toBe('branch_closed');
    await admin.update(Branch, B, { onlineEnabled: true });
  });

  it('5 daqiqada qabul qilinmasa: boshqa ochiq filial yo\'q — bekor (no_branch), olib ketish — bekor (timeout)', async () => {
    const online = { platform: 'android', name: 'Vali', phone: '+998 91 111 11 11', address: 'Uy 7', payment: 'cash', location: INSIDE };
    const items = [{ productId: 'burger', qty: 1 }];
    const delivery = (await http().post('/api/mobile/orders').send({ type: 'delivery', items, online }).expect(201)).body;
    const pickup = (await http().post('/api/mobile/orders').send({ type: 'takeaway', branchId: B, items, online }).expect(201)).body;

    // 4 daqiqa — hali kutadi
    expect(await orders.expirePendingMobile(later(4 * 60_000))).toBe(0);
    const mobile = await connect(url, { orderId: delivery.order.id, orderToken: delivery.trackingToken });
    sockets.push(mobile.socket);
    const event = nextEvent<{ status: string; cancelReason: string }>(mobile.socket);
    expect(await orders.expirePendingMobile(later(6 * 60_000))).toBeGreaterThanOrEqual(2);
    expect(await event).toMatchObject({ status: 'cancelled', cancelReason: 'no_branch' });

    const tracked = await http().get(`/api/mobile/orders/${pickup.order.id}`).set('X-Order-Token', pickup.trackingToken).expect(200);
    expect(tracked.body).toMatchObject({ status: 'cancelled', cancelReason: 'timeout' });
  });

  it('xodim bloklansa — socket darhol uziladi', async () => {
    const kitchen = await login('usr_k');
    const staff = await connect(url, { token: kitchen.token });
    sockets.push(staff.socket);
    const kicked = (socket: Socket) =>
      new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));

    const staffKicked = kicked(staff.socket);
    await app
      .get(UsersService)
      .save({ id: 'usr_k', name: 'Oshpaz yordamchisi', role: 'kitchen', branchId: B, pin: '', active: false }, 'usr_admin_test');
    await staffKicked;
    await http().get('/api/orders/active').set('Authorization', `Bearer ${kitchen.token}`).expect(401);
  });

  it('kassa uzilgach 60 s gacha "ochiq", keyin — "no_kassa"', async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await stateAt(later(30_000))).toBe('open');
    expect(await stateAt(later(61_000))).toBe('no_kassa');
  });
});
