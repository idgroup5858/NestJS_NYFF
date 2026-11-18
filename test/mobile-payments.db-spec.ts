import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { Branch } from '../src/branches/branch.entity';
import { Product } from '../src/menu/product.entity';
import { Order } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { requestOrigin } from '../src/payments/mobile-card.config';
import { MobilePayment } from '../src/payments/mobile-payment.entity';
import { MobilePaymentsService } from '../src/payments/mobile-payments.service';
import { NbuClient, NbuError, readNbuPayment, type NbuPaymentInfo } from '../src/payments/nbu.client';
import { ShiftsService } from '../src/shifts/shifts.service';
import { seedDemo } from './fixtures/demo';
import { actor, createTestApp, expectCode } from './test-app';

/**
 * Mobil ilovada karta bilan to'lov (Milliy Ecom / NBU): to'lov ochish → bank callback'i / holat so'rovi → buyurtma
 * (faqat to'langandan keyin) → kassir qabul qiladi (`card`). Bank — soxtasi (`NbuClient` almashtiriladi).
 */

const now = new Date('2026-10-23T12:00:00');
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const C = 'br_chilonzor';
const IN_CHILONZOR = { lat: 41.28, lng: 69.2 };
const CALLBACK_AUTH = `Basic ${Buffer.from('nbu-test:cb-secret').toString('base64')}`;

const online = { platform: 'android', name: 'Vali', phone: '+998 91 111 11 11', payment: 'card' } as const;
const takeaway = (payment: 'card' | 'cash' = 'card') => ({
  type: 'takeaway' as const,
  branchId: C,
  items: [
    { productId: 'burger-classic', qty: 2 },
    { productId: 'fries', qty: 1 },
  ],
  online: { ...online, payment },
});

const CARD_ENV = {
  NBU_API_KEY: 'test-key',
  NBU_SECRET_KEY: 'test-secret',
  NBU_USERNAME: 'merchant',
  NBU_PASSWORD: 'merchant-pass',
  NBU_CALLBACK_USERNAME: 'nbu-test',
  NBU_CALLBACK_PASSWORD: 'cb-secret',
  PUBLIC_URL: '',
  NBU_SESSION_TIMEOUT: '',
};

describe("mobil ilova: karta bilan to'lov (NBU)", () => {
  let app: INestApplication;
  let em: EntityManager;
  let payments: MobilePaymentsService;
  let orders: OrdersService;
  let shifts: ShiftsService;
  const bank = {
    initPayment: jest.fn<Promise<{ paymentUrl: string; transactionId: string | null }>, [Record<string, unknown>]>(),
    status: jest.fn<Promise<NbuPaymentInfo>, [string]>(),
  };
  const saved: Record<string, string | undefined> = {};
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    for (const [key, value] of Object.entries(CARD_ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    app = await createTestApp((builder) => builder.overrideProvider(NbuClient).useValue(bank));
    em = app.get(DataSource).manager;
    payments = app.get(MobilePaymentsService);
    orders = app.get(OrdersService);
    shifts = app.get(ShiftsService);
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: true }, now);
    bank.initPayment.mockReset().mockImplementation(async (input) => ({
      paymentUrl: `https://ecom.nbu.uz/pay/${String(input.orderId)}`,
      transactionId: 'tx-1',
    }));
    bank.status.mockReset().mockResolvedValue({ orderId: null, state: 'pending', amount: null, transactionId: null });
  });

  const orderCount = () => em.count(Order);
  const paymentRow = (id: string) => em.findOneByOrFail(MobilePayment, { id });
  const success = (id: string, amount: number) => ({ orderId: id, status: 'SUCCESS', amount, transactionId: 'tx-1' });
  /** Ilova `https://fast.example.uz` ga murojaat qilgandek (controller domenni so'rovdan oladi). */
  const open = (dto: Parameters<MobilePaymentsService['create']>[0], at = now) => payments.create(dto, 'https://fast.example.uz', at);

  it("qaytish manzili — ilova murojaat qilgan domen (Android'dagi server); `PUBLIC_URL` yozilgan bo'lsa — o'sha", async () => {
    const order = { ...takeaway(), online: { ...online, phone: '+998 91 111 11 11' } };
    const returnUrl = async (headers: Record<string, string>) =>
      (await http().post('/api/mobile/payments').set(headers).send(order).expect(201)).body.returnUrl as string;

    expect(await returnUrl({ Host: 'fast.newyork24.uz' })).toBe('https://fast.newyork24.uz/api/mobile/payments/return');
    // Apache ortida — u uzatgan domen (so'rov shu kompyuterdan)
    expect(await returnUrl({ 'X-Forwarded-Host': 'newyork24.uz' })).toBe('https://newyork24.uz/api/mobile/payments/return');
    expect(bank.initPayment).toHaveBeenLastCalledWith(
      expect.objectContaining({ successUrl: expect.stringMatching(/^https:\/\/newyork24\.uz\/api\/mobile\/payments\/return\?result=success&id=/) }),
    );
    process.env.PUBLIC_URL = 'https://boshqa.example.uz/';
    try {
      expect(await returnUrl({ Host: 'fast.newyork24.uz' })).toBe('https://boshqa.example.uz/api/mobile/payments/return');
    } finally {
      process.env.PUBLIC_URL = '';
    }
  });

  it('domenni aniqlash: haqiqiy domen — https, lokal manzil — so\'rovdagi protokol', () => {
    expect(requestOrigin('fast.newyork24.uz', 'http')).toBe('https://fast.newyork24.uz');
    expect(requestOrigin('Newyork24.uz, proxy.local', 'http')).toBe('https://newyork24.uz');
    expect(requestOrigin('192.168.1.10:3000', 'http')).toBe('http://192.168.1.10:3000');
    expect(requestOrigin('localhost:3000', 'http')).toBe('http://localhost:3000');
    expect(requestOrigin('10.0.2.2:3000', 'http')).toBe('http://10.0.2.2:3000');
    expect(requestOrigin(undefined, 'http')).toBeNull();
    expect(requestOrigin('evil.uz/yo\'l', 'http')).toBeNull();
  });

  it("karta sozlamalarga qarab: hammasi bor — yoqiq; bittasi bo'sh — o'chiq, to'lov ochilmaydi", async () => {
    expect((await http().get('/api/mobile/payments/methods').expect(200)).body).toEqual({ cash: true, card: true });
    for (const key of ['NBU_CALLBACK_PASSWORD', 'NBU_API_KEY', 'NBU_USERNAME'] as const) {
      process.env[key] = '';
      try {
        expect((await http().get('/api/mobile/payments/methods').expect(200)).body).toEqual({ cash: true, card: false });
        await expectCode('card_unavailable', () => open(takeaway(), now));
      } finally {
        process.env[key] = CARD_ENV[key];
      }
    }
    expect(bank.initPayment).not.toHaveBeenCalled();
  });

  it("`POST /mobile/orders` karta qabul qilmaydi; to'lovga faqat `card`", async () => {
    await expectCode('invalid_input', () => orders.createByMobile(takeaway('card'), now));
    await expectCode('invalid_input', () => open(takeaway('cash'), now));
    expect(bank.initPayment).not.toHaveBeenCalled();
  });

  it("to'lov ochiladi: summa tiyinda, qaytish manzili; buyurtma hali yo'q — filial ko'rmaydi", async () => {
    const before = await orderCount();
    const created = await open(takeaway(), now);
    // 2 × 32 000 + 15 000 — yetkazish narxi kirmaydi
    expect(created.payment).toMatchObject({ status: 'waiting', total: 79_000, orderId: null, error: null });
    expect(created.payment.expiresAt).toEqual(later(900));
    expect(created.returnUrl).toBe('https://fast.example.uz/api/mobile/payments/return');
    expect(created.paymentUrl).toBe(`https://ecom.nbu.uz/pay/${created.payment.id}`);
    expect(created.payment.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(bank.initPayment).toHaveBeenCalledWith({
      orderId: created.payment.id,
      amount: 7_900_000,
      successUrl: `https://fast.example.uz/api/mobile/payments/return?result=success&id=${created.payment.id}`,
      failureUrl: `https://fast.example.uz/api/mobile/payments/return?result=failure&id=${created.payment.id}`,
      sessionTimeout: 900,
    });
    expect(await orderCount()).toBe(before);
    expect((await orders.active(C)).some((order) => order.online?.payment === 'card')).toBe(false);

    // holat — faqat token bilan
    expect(await payments.get(created.payment.id, created.trackingToken, now)).toMatchObject({ status: 'waiting' });
    await expectCode('not_found', () => payments.get(created.payment.id, 'boshqa-token', now));
    await expectCode('not_found', () => payments.get(created.payment.id, undefined, now));
  });

  it("buyurtma tekshiruvlari to'lovdan oldin: sotuvda yo'q taom, bo'sh savat, telefon — bankka bormaydi", async () => {
    await em.update(Product, 'fries', { active: false });
    await expectCode('product_unavailable', () => open(takeaway(), now));
    await expectCode('empty_order', () => open({ ...takeaway(), items: [] }, now));
    await expectCode('phone_required', () => open({ ...takeaway(), online: { ...online, phone: '12' } }, now));
    expect(bank.initPayment).not.toHaveBeenCalled();
  });

  it("bank to'lov ochmasa — `card_unavailable`, yozuv qolmaydi", async () => {
    bank.initPayment.mockRejectedValueOnce(new NbuError('payment/init: HTTP 400, code=4001'));
    await expectCode('card_unavailable', () => open(takeaway(), now));
    expect(await em.count(MobilePayment)).toBe(0);
  });

  it("callback SUCCESS → buyurtma filialga (pending, karta), shu token bilan kuzatiladi; kassir qabul qiladi → smenada `card`", async () => {
    const created = await open(takeaway(), now);
    const id = created.payment.id;

    await http().post('/api/callback').set('Authorization', CALLBACK_AUTH).send(success(id, 7_900_000)).expect(200, {
      status: 'accepted',
    });
    const paid = await payments.get(id, created.trackingToken, later(10));
    expect(paid).toMatchObject({ status: 'paid', error: null });
    expect(paid.orderId).toMatch(/^ord_/);
    expect(await paymentRow(id)).toMatchObject({ transactionId: 'tx-1', bank: success(id, 7_900_000) });

    const order = await orders.track(paid.orderId!, created.trackingToken);
    expect(order).toMatchObject({
      branchId: C,
      type: 'takeaway',
      status: 'pending',
      total: 79_000,
      payment: null,
      online: { name: 'Vali', payment: 'card' },
    });
    expect((await orders.active(C)).map((o) => o.id)).toContain(order.id);

    await shifts.openOrResume('usr_cashier_c1', C, later(20));
    const accepted = await orders.confirm(order.id, actor('usr_cashier_c1', 'cashier', C), {}, later(30));
    expect(accepted).toMatchObject({ status: 'preparing', payment: 'card', split: null });

    // takroriy callback — ikkinchi buyurtma yo'q
    const count = await orderCount();
    await payments.handleCallback(success(id, 7_900_000), later(40));
    expect(await orderCount()).toBe(count);
  });

  it("callback: login / parolsiz — 401; begona orderId (test sahifasi) — 200, hech narsa", async () => {
    await http().post('/api/callback').send({ orderId: 'x', status: 'SUCCESS' }).expect(401);
    await http()
      .post('/api/callback')
      .set('Authorization', `Basic ${Buffer.from('nbu-test:wrong').toString('base64')}`)
      .send({})
      .expect(401);
    const before = await orderCount();
    await http()
      .post('/api/callback')
      .set('Authorization', CALLBACK_AUTH)
      .send({ orderId: '01a1edac-97bb-73aa-92a7-950c5d46c539', status: 'SUCCESS', amount: 100000 })
      .expect(200);
    expect(await orderCount()).toBe(before);
  });

  it("callback FAILED → `failed`, buyurtma yo'q", async () => {
    const created = await open(takeaway(), now);
    const before = await orderCount();
    await payments.handleCallback({ orderId: created.payment.id, status: 'FAILED' }, later(30));
    expect(await payments.get(created.payment.id, created.trackingToken, later(31))).toMatchObject({
      status: 'failed',
      orderId: null,
    });
    expect(await orderCount()).toBe(before);
  });

  it("callback kelmasa — ilova so'raganda bankdan holat olinadi (5 soniyada ko'pi bilan bir marta)", async () => {
    const created = await open(takeaway(), now);
    const id = created.payment.id;
    // 5 soniya o'tmagan — bankka bormaydi
    await payments.get(id, created.trackingToken, later(3));
    expect(bank.status).not.toHaveBeenCalled();

    bank.status.mockResolvedValueOnce({ orderId: id, state: 'pending', amount: null, transactionId: null });
    expect(await payments.get(id, created.trackingToken, later(10))).toMatchObject({ status: 'waiting' });
    expect(bank.status).toHaveBeenCalledWith(id);

    bank.status.mockResolvedValueOnce({ orderId: id, state: 'success', amount: 7_900_000, transactionId: 'tx-9' });
    const paid = await payments.get(id, created.trackingToken, later(20));
    expect(paid.status).toBe('paid');
    expect(paid.orderId).toMatch(/^ord_/);
    expect((await paymentRow(id)).transactionId).toBe('tx-9');
  });

  it("fon ishi: muddati o'tdi, bank to'lanmagan dedi → `expired`; kech kelgan SUCCESS ham buyurtma bo'ladi", async () => {
    const created = await open(takeaway(), now);
    const id = created.payment.id;

    // muddat ichida — har daqiqada bankdan so'raladi, yopilmaydi
    await payments.sweep(later(70));
    expect(bank.status).toHaveBeenCalledTimes(1);
    expect((await paymentRow(id)).status).toBe('waiting');

    // 15 daqiqa + 1 daqiqa kutish
    await payments.sweep(later(900 + 61));
    expect((await paymentRow(id)).status).toBe('expired');

    // mijoz oxirgi soniyada to'lagan — bank keyin xabar berdi
    await payments.handleCallback(success(id, 7_900_000), later(1000));
    const row = await paymentRow(id);
    expect(row.status).toBe('paid');
    expect(row.orderId).toMatch(/^ord_/);
  });

  it("fon ishi: bankka ulanib bo'lmasa — yopilmaydi, 30 daqiqadan keyin `expired`; bank xato qaytarsa — darhol", async () => {
    const first = await open(takeaway(), now);
    const second = await open(takeaway(), now);
    bank.status.mockImplementation(async (id) => {
      if (id === first.payment.id) throw new TypeError('fetch failed');
      throw new NbuError('payment/status: HTTP 200, code=4040 not found');
    });
    await payments.sweep(later(900 + 61));
    expect((await paymentRow(first.payment.id)).status).toBe('waiting');
    expect((await paymentRow(second.payment.id)).status).toBe('expired');

    await payments.sweep(later(900 + 30 * 60));
    expect((await paymentRow(first.payment.id)).status).toBe('expired');
  });

  it("to'langan narx saqlanadi: oradagi daqiqalarda narx o'zgarsa yoki taom sotuvdan olinsa ham buyurtma yoziladi", async () => {
    const created = await open(takeaway(), now);
    await em.update(Product, 'burger-classic', { price: 40_000 });
    await em.update(Product, 'fries', { active: false });
    await payments.handleCallback(success(created.payment.id, 7_900_000), later(60));
    const { orderId } = await paymentRow(created.payment.id);
    const order = await em.findOneByOrFail(Order, { id: orderId! });
    expect(order.total).toBe(79_000);
    expect(order.items.map((item) => [item.productId, item.price, item.qty])).toEqual([
      ['burger-classic', 32_000, 2],
      ['fries', 15_000, 1],
    ]);
  });

  it("to'langan, lekin buyurtma yaratib bo'lmadi (filial faol emas) — `error`, admin pulni qaytaradi", async () => {
    const created = await open(takeaway(), now);
    await em.update(Branch, C, { active: false });
    const before = await orderCount();
    await payments.handleCallback(success(created.payment.id, 7_900_000), later(60));
    expect(await payments.get(created.payment.id, created.trackingToken, later(61))).toMatchObject({
      status: 'paid',
      orderId: null,
      error: 'not_found',
    });
    expect(await orderCount()).toBe(before);
    // fon ishi qayta urinmaydi
    await em.update(Branch, C, { active: true });
    await payments.sweep(later(120));
    expect((await paymentRow(created.payment.id)).orderId).toBeNull();
  });

  it("dostavka: filialni server tanlaydi, yetkazish narxi summaga kirmaydi — buyurtmada saqlanadi", async () => {
    const created = await open(
      {
        type: 'delivery',
        items: [{ productId: 'burger-classic', qty: 1 }],
        online: { ...online, address: 'Chilonzor 9', location: IN_CHILONZOR },
      },
      now,
    );
    expect(bank.initPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 3_200_000 }));
    await payments.handleCallback(success(created.payment.id, 3_200_000), later(60));
    const { orderId } = await paymentRow(created.payment.id);
    expect(await em.findOneByOrFail(Order, { id: orderId! })).toMatchObject({
      branchId: C,
      type: 'delivery',
      total: 32_000,
      deliveryFee: 10_000,
      online: { payment: 'card', location: IN_CHILONZOR },
    });
  });

  it('qaytish sahifasi — HTML', async () => {
    const page = await http().get('/api/mobile/payments/return?result=success&id=x').expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain("To'lov qabul qilindi");
    expect((await http().get('/api/mobile/payments/return?result=failure').expect(200)).text).toContain("To'lov o'tmadi");
  });

  it("bank xabarini o'qish: ichma-ich `data`, matndagi summa, noma'lum holat — kutilmoqda", () => {
    expect(readNbuPayment({ data: { orderId: 'a', status: 'success', amount: '100000', transactionId: 't' } })).toEqual({
      orderId: 'a',
      state: 'success',
      amount: 100000,
      transactionId: 't',
    });
    expect(readNbuPayment([{ orderId: 'b', status: 'DECLINED' }, { orderId: 'a', transactionStatus: 'PAID' }], 'a')).toMatchObject({
      orderId: 'a',
      state: 'success',
    });
    expect(readNbuPayment({ orderId: 'a', status: 'CREATED' })).toMatchObject({ state: 'pending', amount: null });
    expect(readNbuPayment({ orderId: 'a', status: 'EXPIRED' }).state).toBe('failed');
    expect(readNbuPayment(null)).toEqual({ orderId: null, state: 'pending', amount: null, transactionId: null });
  });
});
