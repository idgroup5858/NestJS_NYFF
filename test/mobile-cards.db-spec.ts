import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { Order } from '../src/orders/order.entity';
import { MobileCard } from '../src/payments/mobile-card.entity';
import { MobileCardsService } from '../src/payments/mobile-cards.service';
import { MobilePayment } from '../src/payments/mobile-payment.entity';
import { MobilePaymentsService } from '../src/payments/mobile-payments.service';
import { NbuClient, NbuError, readNbuCardBinding, type NbuPaymentInfo } from '../src/payments/nbu.client';
import { seedDemo } from './fixtures/demo';
import { createTestApp, expectCode } from './test-app';

/**
 * Bog'langan kartalar: telefonga bog'lash (`X-Client-Key`), bank callback'i `CARD_BINDING` (`cardToken`,
 * `maskedPan`), saqlangan kartadan darhol to'lov (`/payment/charge`), o'chirish (`/payment/unbind`). Bank — soxtasi.
 */

const now = new Date('2026-10-23T12:00:00');
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const C = 'br_chilonzor';
const PHONE_A = 'a'.repeat(43);
const PHONE_B = 'b'.repeat(43);
const CALLBACK_AUTH = `Basic ${Buffer.from('nbu-test:cb-secret').toString('base64')}`;
const TOKEN = '01a1f36a-e37e-7277-96fb-fabbef77e3b9';

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

const order = (cardId?: string) => ({
  type: 'takeaway' as const,
  branchId: C,
  items: [{ productId: 'burger-classic', qty: 1 }],
  online: { platform: 'android', name: 'Vali', phone: '+998 91 111 11 11', payment: 'card' } as const,
  ...(cardId ? { cardId } : {}),
});

/** Haqiqiy callback shakli (2026-11-19, `fast` logidan). */
const bindingCallback = (orderId: string, extra: Record<string, unknown> = {}) => ({
  transactionId: '01a1f368-43e7-71dc-a4f5-2c86a6327ab7',
  orderId,
  status: 'SUCCESS',
  amount: 0,
  currency: 860,
  purpose: 'CARD_BINDING',
  subscriptionId: null,
  createdAt: '2026-11-19 15:44:19',
  paidAt: null,
  errorCode: null,
  clientId: 'cl_x',
  maskedPan: '9860********4764',
  cardToken: TOKEN,
  fields: null,
  ...extra,
});

describe("mobil ilova: bog'langan kartalar (NBU)", () => {
  let app: INestApplication;
  let em: EntityManager;
  let cards: MobileCardsService;
  let payments: MobilePaymentsService;
  const bank = {
    initPayment: jest.fn(),
    status: jest.fn<Promise<NbuPaymentInfo>, [string]>(),
    bind: jest.fn<Promise<{ paymentUrl: string; transactionId: string | null }>, [Record<string, unknown>]>(),
    charge: jest.fn<Promise<NbuPaymentInfo>, [{ orderId: string; cardToken: string; amount: number }]>(),
    unbind: jest.fn<Promise<void>, [{ clientId: string; cardToken: string }]>(),
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
    cards = app.get(MobileCardsService);
    payments = app.get(MobilePaymentsService);
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
    bank.bind.mockReset().mockImplementation(async (input) => ({
      paymentUrl: `https://ecom.nbu.uz/m/${String(input.orderId)}`,
      transactionId: 'tx-bind',
    }));
    bank.charge.mockReset().mockImplementation(async (input) => ({
      orderId: input.orderId,
      state: 'success',
      amount: input.amount,
      transactionId: null,
    }));
    bank.unbind.mockReset().mockResolvedValue(undefined);
    bank.status.mockReset().mockResolvedValue({ orderId: null, state: 'pending', amount: null, transactionId: null });
  });

  /** Telefonda karta bog'lash: bank sahifasi → callback. */
  const bindCard = async (key = PHONE_A, extra: Record<string, unknown> = {}) => {
    const started = await cards.startBinding(key, 'https://fast.example.uz', now);
    await cards.handleCallback(bindingCallback(started.binding.id, extra), later(30));
    return started.binding.id;
  };

  it('kalitsiz / noto\'g\'ri kalit — `unauthorized`', async () => {
    await http().get('/api/mobile/cards').expect(401);
    await http().get('/api/mobile/cards').set('X-Client-Key', 'qisqa').expect(401);
    expect((await http().get('/api/mobile/cards').set('X-Client-Key', PHONE_A).expect(200)).body).toEqual([]);
  });

  it("bog'lash: bank sahifasi → callback'dan token va yashirin raqam → ro'yxatda (tokensiz)", async () => {
    const res = await http()
      .post('/api/mobile/cards/bind')
      .set('X-Client-Key', PHONE_A)
      .set('Host', 'fast.newyork24.uz')
      .expect(201);
    const id = res.body.binding.id as string;
    expect(res.body).toEqual({
      binding: { id, status: 'pending', card: null },
      paymentUrl: `https://ecom.nbu.uz/m/${id}`,
      returnUrl: 'https://fast.newyork24.uz/api/mobile/payments/return',
    });
    const [bindInput] = bank.bind.mock.calls[0];
    expect(bindInput).toMatchObject({
      orderId: id,
      successUrl: `https://fast.newyork24.uz/api/mobile/payments/return?result=success&id=${id}`,
      sessionTimeout: 900,
    });
    // bankka kalitning o'zi emas — xeshidan qisqa id
    expect(bindInput.clientId).toMatch(/^cl_[0-9a-f]{24}$/);
    expect(JSON.stringify(bindInput)).not.toContain(PHONE_A);
    expect((await http().get('/api/mobile/cards').set('X-Client-Key', PHONE_A).expect(200)).body).toEqual([]);

    await http().post('/api/callback').set('Authorization', CALLBACK_AUTH).send(bindingCallback(id)).expect(200);
    const list = (await http().get('/api/mobile/cards').set('X-Client-Key', PHONE_A).expect(200)).body;
    expect(list).toEqual([{ id, maskedPan: '9860********4764', createdAt: expect.any(String) }]);
    expect(JSON.stringify(list)).not.toContain(TOKEN);
    expect((await http().get(`/api/mobile/cards/bind/${id}`).set('X-Client-Key', PHONE_A).expect(200)).body).toMatchObject({
      status: 'active',
      card: { id, maskedPan: '9860********4764' },
    });
    const row = await em.createQueryBuilder(MobileCard, 'c').addSelect('c.cardToken').where('c.id = :id', { id }).getOneOrFail();
    expect(row.cardToken).toBe(TOKEN);
  });

  it("boshqa telefon kartani ko'rmaydi, o'chira olmaydi, to'lay olmaydi", async () => {
    const id = await bindCard(PHONE_A);
    expect(await cards.list(PHONE_B)).toEqual([]);
    await expectCode('not_found', () => cards.binding(PHONE_B, id));
    await expectCode('not_found', () => cards.remove(PHONE_B, id));
    await expectCode('not_found', () => payments.create(order(id), null, now, PHONE_B));
    await expectCode('unauthorized', () => payments.create(order(id), null, now, undefined));
    expect(bank.charge).not.toHaveBeenCalled();
    expect(await cards.list(PHONE_A)).toHaveLength(1);
  });

  it("bog'lanmadi (FAILED) — ro'yxatda yo'q; xuddi shu karta qayta bog'lansa — bitta", async () => {
    const started = await cards.startBinding(PHONE_A, 'https://fast.example.uz', now);
    await cards.handleCallback(bindingCallback(started.binding.id, { status: 'FAILED', cardToken: null }), later(30));
    expect(await cards.binding(PHONE_A, started.binding.id)).toMatchObject({ status: 'failed', card: null });
    expect(await cards.list(PHONE_A)).toEqual([]);

    await bindCard(PHONE_A);
    await bindCard(PHONE_A);
    expect(await cards.list(PHONE_A)).toHaveLength(1);
    // takroriy callback — o'zgarmaydi
    const [card] = await cards.list(PHONE_A);
    await cards.handleCallback(bindingCallback(card.id), later(60));
    expect(await cards.list(PHONE_A)).toHaveLength(1);
  });

  it("saqlangan kartadan: bank sahifasisiz, darhol buyurtma (pending, karta) — takroriy CHARGE callback'i ikkinchi buyurtma qilmaydi", async () => {
    const cardId = await bindCard();
    const before = await em.count(Order);
    const res = await payments.create(order(cardId), null, later(60), PHONE_A);
    expect(res.paymentUrl).toBeNull();
    expect(res.returnUrl).toBeNull();
    expect(res.payment).toMatchObject({ status: 'paid', total: 32_000, error: null });
    expect(bank.charge).toHaveBeenCalledWith({ orderId: res.payment.id, cardToken: TOKEN, amount: 3_200_000 });
    expect(await em.count(Order)).toBe(before + 1);
    const created = await em.findOneByOrFail(Order, { id: res.payment.orderId! });
    expect(created).toMatchObject({ status: 'pending', branchId: C, online: { payment: 'card' } });
    expect((await em.findOneByOrFail(MobilePayment, { id: res.payment.id })).cardId).toBe(cardId);

    await http()
      .post('/api/callback')
      .set('Authorization', CALLBACK_AUTH)
      .send({ orderId: res.payment.id, status: 'SUCCESS', amount: 3_200_000, purpose: 'CHARGE' })
      .expect(200);
    expect(await em.count(Order)).toBe(before + 1);

    // HTTP orqali ham (sarlavha bilan)
    const http201 = await http()
      .post('/api/mobile/payments')
      .set('X-Client-Key', PHONE_A)
      .send(order(cardId))
      .expect(201);
    expect(http201.body).toMatchObject({ paymentUrl: null, returnUrl: null, payment: { status: 'paid' } });
  });

  it("kartadan yechilmadi (FAILED yoki bank xatosi) — `card_declined`, buyurtma yo'q", async () => {
    const cardId = await bindCard();
    const before = await em.count(Order);
    bank.charge.mockResolvedValueOnce({ orderId: null, state: 'failed', amount: null, transactionId: null });
    await expectCode('card_declined', () => payments.create(order(cardId), null, later(60), PHONE_A));
    bank.charge.mockRejectedValueOnce(new NbuError('payment/charge: HTTP 200, code=3005 Недостаточно средств'));
    await expectCode('card_declined', () => payments.create(order(cardId), null, later(70), PHONE_A));
    expect(await em.count(Order)).toBe(before);
    const rows = await em.find(MobilePayment, { where: { cardId } });
    expect(rows.map((row) => row.status)).toEqual(['failed', 'failed']);
  });

  it("bank javob bermadi — natija noma'lum: kutadi, ilova so'raganda bankdan holat → buyurtma", async () => {
    const cardId = await bindCard();
    bank.charge.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await payments.create(order(cardId), null, later(60), PHONE_A);
    expect(res.payment).toMatchObject({ status: 'waiting', orderId: null });
    bank.status.mockResolvedValueOnce({ orderId: res.payment.id, state: 'success', amount: 3_200_000, transactionId: 't' });
    const checked = await payments.get(res.payment.id, res.trackingToken, later(70));
    expect(checked.status).toBe('paid');
    expect(checked.orderId).toMatch(/^ord_/);
  });

  it("o'chirish: bankda uziladi va ro'yxatdan chiqadi; bank xatosi bo'lsa ham o'chadi", async () => {
    const first = await bindCard(PHONE_A);
    await http().delete(`/api/mobile/cards/${first}`).set('X-Client-Key', PHONE_A).expect(204);
    expect(bank.unbind).toHaveBeenCalledWith({ clientId: expect.stringMatching(/^cl_/), cardToken: TOKEN });
    expect(await cards.list(PHONE_A)).toEqual([]);
    await expectCode('not_found', () => payments.create(order(first), null, later(60), PHONE_A));

    const second = await bindCard(PHONE_A, { cardToken: '01a1f36a-0000-7000-8000-000000000002' });
    bank.unbind.mockRejectedValueOnce(new NbuError('payment/unbind: code=5000'));
    await cards.remove(PHONE_A, second);
    expect(await cards.list(PHONE_A)).toEqual([]);
  });

  it("fon ishi: bir kundan eski bog'lanmagan yozuvlar o'chadi, faol karta qoladi", async () => {
    const active = await bindCard();
    await cards.startBinding(PHONE_A, 'https://fast.example.uz', now);
    expect(await cards.cleanup(later(60))).toBe(0);
    expect(await cards.cleanup(later(25 * 3600))).toBe(1);
    expect((await cards.list(PHONE_A)).map((card) => card.id)).toEqual([active]);
  });

  it("bog'lash callback'ini o'qish — haqiqiy shakl", () => {
    expect(readNbuCardBinding(bindingCallback('o-1'))).toEqual({
      orderId: 'o-1',
      state: 'success',
      cardToken: TOKEN,
      maskedPan: '9860********4764',
    });
    expect(readNbuCardBinding({ orderId: 'o-2', status: 'EXPIRED' })).toEqual({
      orderId: 'o-2',
      state: 'failed',
      cardToken: null,
      maskedPan: null,
    });
  });
});
