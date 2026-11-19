import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { fail } from '../common/errors';
import { newSecret, sha256 } from '../common/ids';
import { uuidv7 } from '../nbu-test/nbu-crypto';
import type { Order } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { mobileCardConfig, mobileCardSetup, RETURN_PATH } from './mobile-card.config';
import { MobileCardsService } from './mobile-cards.service';
import type { MobilePaymentDto } from './mobile-payment.dto';
import { MobilePayment } from './mobile-payment.entity';
import { NbuClient, NbuError, readNbuPayment, type NbuPaymentInfo } from './nbu.client';

/** Ilovaga ko'rinadigan to'lov holati. `orderId` — to'langandan keyin; `error` — to'langan, lekin buyurtma yaratilmadi. */
export interface MobilePaymentView {
  id: string;
  status: MobilePayment['status'];
  total: number;
  expiresAt: Date;
  orderId: string | null;
  error: string | null;
}

function paymentView(payment: MobilePayment): MobilePaymentView {
  return {
    id: payment.id,
    status: payment.status,
    total: payment.total,
    expiresAt: payment.expiresAt,
    orderId: payment.orderId,
    error: payment.error,
  };
}

/** Ilova "holat qanday?" deb so'raganda bankdan ko'pi bilan shuncha vaqtda bir marta so'raladi. */
const CHECK_ON_READ_MS = 5_000;
/** Callback kelmay qolsa — fon ishi kutayotgan to'lovni bankdan shuncha vaqtda bir marta so'raydi. */
const CHECK_IN_BACKGROUND_MS = 60_000;
/** Bank sahifasi yopilgandan keyin oxirgi tekshiruvgacha kutish (mijoz oxirgi soniyada to'lagan bo'lishi mumkin). */
const EXPIRY_GRACE_MS = 60_000;
/** Bankka ulanib bo'lmasa — to'lovni "muddati o'tdi" deyishdan oldin shuncha kutiladi (pul yechilgan bo'lishi mumkin). */
const UNREACHABLE_GIVE_UP_MS = 30 * 60_000;
/** Saqlangan kartadan yechish — bank sahifasi yo'q; javob kelmay qolsa holat shu muddatgacha so'raladi. */
const SAVED_CARD_EXPIRY_MS = 5 * 60_000;

/** Bank xabari `mobile_payments.bank` ga (obyekt bo'lmasa — o'ralib). */
function bankRecord(raw: unknown): object | null {
  if (raw === null || raw === undefined) return null;
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : { value: raw };
}

/** Xato kodi (`fail()` dan) yoki qisqa matn — `mobile_payments.error` ga. */
function errorCode(error: unknown): string {
  const response = error instanceof HttpException ? (error.getResponse() as { code?: unknown }) : null;
  if (typeof response?.code === 'string') return response.code;
  return 'order_failed';
}

/**
 * Mobil ilovada karta bilan to'lov (Milliy Ecom / NBU). Tartib: ilova `POST /mobile/payments` → server buyurtmani
 * tekshiradi, bankda to'lov ochadi va `paymentUrl` qaytaradi (buyurtma hali yo'q, filial ko'rmaydi) → mijoz bank
 * sahifasida to'laydi → bank callback'i (`/api/callback`) yoki holat so'rovi "to'landi" → buyurtma yaratiladi va
 * filialga tushadi (`pending`, kassir qabul qiladi, smenaga `card`). To'lanmasa — `expired` / `failed`, buyurtma
 * umuman yo'q. Pul qaytarish tizimda yo'q (admin o'zi qaytaradi).
 */
@Injectable()
export class MobilePaymentsService implements OnModuleInit {
  private readonly logger = new Logger('MobilePayments');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly nbu: NbuClient,
    private readonly cards: MobileCardsService,
  ) {}

  onModuleInit() {
    const { config, missing } = mobileCardSetup();
    if (missing.length) this.logger.warn(`Mobil ilovada karta o'chiq — .env da yo'q: ${missing.join(', ')}`);
    else if (config) {
      const returnTo = config.publicUrl ?? 'ilova murojaat qilgan domen';
      this.logger.log(`Mobil ilovada karta bilan to'lov yoqiq (qaytish manzili: ${returnTo})`);
    }
  }

  /** Ilova "Karta" tugmasini shunga qarab ko'rsatadi. */
  methods(): { cash: true; card: boolean } {
    return { cash: true, card: mobileCardConfig() !== null };
  }

  /**
   * To'lov ochish: buyurtma `POST /mobile/orders` dagidek tekshiriladi (forma, filial, taomlar), summa — taomlar
   * (yetkazish narxi kirmaydi — kuryerga alohida). Javobda `paymentUrl` (bank sahifasi), `returnUrl` (to'lovdan keyin
   * bank shu manzilga qaytaradi — ilova uni ushlaydi) va `trackingToken` (to'lovni, keyin buyurtmani kuzatish).
   * [origin] — ilova murojaat qilgan manzil (`https://fast.newyork24.uz`, controller so'rovdan oladi); `.env` dagi
   * `PUBLIC_URL` yozilgan bo'lsa — o'sha.
   */
  async create(
    dto: MobilePaymentDto,
    origin: string | null,
    now = new Date(),
    clientKey?: string,
  ): Promise<{ payment: MobilePaymentView; paymentUrl: string | null; returnUrl: string | null; trackingToken: string }> {
    const config = mobileCardConfig() ?? fail('card_unavailable');
    if (dto.online.payment !== 'card') fail('invalid_input', 'online.payment: card');
    // saqlangan karta — shu telefonniki (boshqa telefon kartasi — `not_found`)
    const saved = dto.cardId ? await this.cards.tokenFor(clientKey, dto.cardId) : null;
    const prepared = await this.orders.prepareMobile(dto, now);
    const lines = dto.items.map(({ productId, qty }) => ({ productId, qty }));
    const items = await this.orders.quoteMobile(prepared.branchId, dto.type, lines);
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (total <= 0) fail('invalid_amount');

    const id = uuidv7();
    const trackingToken = newSecret(24);
    const draft = {
      id,
      status: 'waiting' as const,
      branchId: prepared.branchId,
      type: dto.type,
      lines,
      items,
      note: dto.note?.trim() ?? '',
      online: prepared.online,
      deliveryFee: prepared.deliveryFee,
      total,
      trackingTokenHash: sha256(trackingToken),
      orderId: null,
      error: null,
      bank: null,
      createdAt: now,
      paidAt: null,
      checkedAt: null,
    };
    if (saved) return this.chargeSaved({ ...draft, cardId: saved.cardId }, saved.cardToken, trackingToken, now);

    const base = config.publicUrl ?? origin ?? fail('card_unavailable', 'server manzili aniqlanmadi');
    const returnUrl = `${base}${RETURN_PATH}`;
    let bank: { paymentUrl: string; transactionId: string | null };
    try {
      bank = await this.nbu.initPayment({
        orderId: id,
        amount: total * 100,
        successUrl: `${returnUrl}?result=success&id=${id}`,
        failureUrl: `${returnUrl}?result=failure&id=${id}`,
        sessionTimeout: config.sessionSeconds,
      });
    } catch (error) {
      this.logger.error(`To'lov ochilmadi (${id}, ${total} so'm): ${(error as Error).message}`);
      fail('card_unavailable');
    }

    const payment: MobilePayment = {
      ...draft,
      cardId: null,
      paymentUrl: bank.paymentUrl,
      transactionId: bank.transactionId,
      expiresAt: new Date(now.getTime() + config.sessionSeconds * 1000),
    };
    await this.dataSource.manager.insert(MobilePayment, payment);
    this.logger.log(`To'lov ochildi: ${id}, ${total} so'm, filial ${prepared.branchId}, qaytish — ${returnUrl}`);
    return { payment: paymentView(payment), paymentUrl: bank.paymentUrl, returnUrl, trackingToken };
  }

  /**
   * Saqlangan kartadan: yozuv avval (bank callback'i `CHARGE` javobdan oldin kelsa ham topsin), keyin `/payment/charge`
   * — natija darhol. `SUCCESS` — buyurtma shu so'rovning o'zida yaratiladi; `FAILED` / bank xatosi — `card_declined`
   * (pul yechilmagan); tarmoq xatosi — natija noma'lum: `waiting`, ilova holatni so'raydi (server bankdan so'raydi).
   */
  private async chargeSaved(
    draft: Omit<MobilePayment, 'paymentUrl' | 'transactionId' | 'expiresAt'>,
    cardToken: string,
    trackingToken: string,
    now: Date,
  ): Promise<{ payment: MobilePaymentView; paymentUrl: null; returnUrl: null; trackingToken: string }> {
    const payment: MobilePayment = {
      ...draft,
      paymentUrl: null,
      transactionId: null,
      expiresAt: new Date(now.getTime() + SAVED_CARD_EXPIRY_MS),
    };
    await this.dataSource.manager.insert(MobilePayment, payment);
    let info: NbuPaymentInfo;
    try {
      info = await this.nbu.charge({ orderId: payment.id, cardToken, amount: payment.total * 100 });
    } catch (error) {
      if (error instanceof NbuError) {
        await this.close(payment.id, 'failed', { error: error.message }, now);
        this.logger.warn(`Kartadan yechilmadi (${payment.id}, karta ${payment.cardId}): ${error.message}`);
        fail('card_declined', error.message.slice(0, 200));
      }
      this.logger.warn(`Kartadan yechish (${payment.id}) javobsiz: ${(error as Error).message} — holat bankdan so'raladi`);
      return { payment: paymentView(payment), paymentUrl: null, returnUrl: null, trackingToken };
    }
    await this.apply(payment.id, info, info, now);
    const row = await this.dataSource.manager.findOneByOrFail(MobilePayment, { id: payment.id });
    if (row.status === 'failed') fail('card_declined');
    this.logger.log(`Saqlangan kartadan: ${payment.id}, ${payment.total} so'm — ${row.status}`);
    return { payment: paymentView(row), paymentUrl: null, returnUrl: null, trackingToken };
  }

  /**
   * To'lov holati (ilova bank sahifasi yopilgandan keyin so'raydi). Hali kutilayotgan bo'lsa — bankdan ham so'raladi
   * (callback kechiksa ham natija darhol ko'rinsin); bank javob bermasa — oxirgi ma'lum holat.
   */
  async get(id: string, token: string | undefined, now = new Date()): Promise<MobilePaymentView> {
    let payment = await this.findWithToken(id, token);
    const lastCheck = (payment.checkedAt ?? payment.createdAt).getTime();
    if (payment.status === 'waiting' && now.getTime() - lastCheck >= CHECK_ON_READ_MS) {
      await this.check(payment.id, now);
      payment = await this.dataSource.manager.findOneByOrFail(MobilePayment, { id });
    }
    return paymentView(payment);
  }

  /** Bank callback'i (`/api/callback`, Basic login / parol bilan). Bizda yo'q `orderId` (test sahifasi) — e'tiborsiz. */
  async handleCallback(body: unknown, now = new Date()): Promise<void> {
    const info = readNbuPayment(body);
    if (!info.orderId) {
      this.logger.warn("Callback'da orderId yo'q");
      return;
    }
    const exists = await this.dataSource.manager.existsBy(MobilePayment, { id: info.orderId });
    if (!exists) {
      this.logger.log(`Callback: ${info.orderId} — mobil to'lov emas (test sahifasi?), e'tiborsiz`);
      return;
    }
    await this.apply(info.orderId, info, body, now);
  }

  /**
   * Fon ishi (har 30 soniyada): to'langan, lekin buyurtmasi yo'q (server o'chib qolgan) — qayta; kutayotganlar —
   * callback kelmay qolgan bo'lsa bankdan so'rash, muddati o'tganini yopish.
   */
  async sweep(now = new Date()): Promise<void> {
    const unconverted = await this.dataSource.manager.find(MobilePayment, {
      where: { status: 'paid', orderId: IsNull(), error: IsNull() },
    });
    for (const payment of unconverted) await this.convert(payment.id, now);

    const waiting = await this.dataSource.manager.find(MobilePayment, {
      where: { status: 'waiting' },
      order: { createdAt: 'ASC' },
    });
    for (const payment of waiting) {
      const overdue = now.getTime() >= payment.expiresAt.getTime() + EXPIRY_GRACE_MS;
      const due = now.getTime() - (payment.checkedAt ?? payment.createdAt).getTime() >= CHECK_IN_BACKGROUND_MS;
      if (!overdue && !due) continue;
      const result = await this.check(payment.id, now);
      if (!overdue) continue;
      // bank "to'lanmagan" dedi yoki o'zi xato qaytardi (to'lov topilmadi) — yopiladi; bankka ulanib bo'lmasa — kutiladi
      const bankAnswered = result === 'pending' || result === 'bank_error';
      const givenUp = now.getTime() >= payment.expiresAt.getTime() + UNREACHABLE_GIVE_UP_MS;
      if (bankAnswered || (result === 'unreachable' && givenUp)) await this.close(payment.id, 'expired', null, now);
    }
  }

  // ───────────────────────── ichki ─────────────────────────

  private async findWithToken(id: string, token: string | undefined): Promise<MobilePayment> {
    const payment = await this.dataSource.manager
      .createQueryBuilder(MobilePayment, 'p')
      .addSelect('p.trackingTokenHash')
      .where('p.id = :id', { id })
      .getOne();
    if (!payment || !token || payment.trackingTokenHash !== sha256(token)) fail('not_found', `payment ${id}`);
    return payment;
  }

  /** Bankdan holatni so'rab, natijani qo'llaydi. */
  private async check(id: string, now: Date): Promise<NbuPaymentInfo['state'] | 'bank_error' | 'unreachable'> {
    try {
      const info = await this.nbu.status(id);
      await this.dataSource.manager.update(MobilePayment, id, { checkedAt: now });
      await this.apply(id, info, info, now);
      return info.state;
    } catch (error) {
      await this.dataSource.manager.update(MobilePayment, id, { checkedAt: now });
      const bankError = error instanceof NbuError;
      this.logger.warn(`Holat so'rovi (${id}): ${(error as Error).message}`);
      return bankError ? 'bank_error' : 'unreachable';
    }
  }

  private async apply(id: string, info: NbuPaymentInfo, raw: unknown, now: Date): Promise<void> {
    if (info.state === 'success') {
      await this.markPaid(id, info, raw, now);
      await this.convert(id, now);
    } else if (info.state === 'failed') {
      await this.close(id, 'failed', raw, now);
    }
  }

  /**
   * Bank "to'landi" dedi — pul yechilgan, avval shu yoziladi (buyurtma keyingi qadamda). Muddati o'tgan / rad etilgan
   * deb yopilgan to'lov ham (mijoz oxirgi soniyada to'lagan) — to'langan bo'ladi.
   */
  private async markPaid(id: string, info: NbuPaymentInfo, raw: unknown, now: Date): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const payment = await this.lock(em, id);
      if (!payment || payment.status === 'paid') return;
      if (info.amount !== null && info.amount !== payment.total * 100) {
        this.logger.warn(`To'lov ${id}: bank summasi ${info.amount} tiyin, kutilgan ${payment.total * 100}`);
      }
      await em.update(MobilePayment, id, {
        status: 'paid',
        paidAt: now,
        transactionId: info.transactionId ?? payment.transactionId,
        bank: bankRecord(raw),
      });
      this.logger.log(`To'landi: ${id} (${payment.total} so'm)`);
    });
  }

  /** To'langan → buyurtma (bir marta). Yaratib bo'lmasa — xato kodi yoziladi, admin pulni qaytaradi. */
  private async convert(id: string, now: Date): Promise<void> {
    let order: Order | null;
    try {
      order = await this.dataSource.transaction(async (em) => {
        const payment = await this.lock(em, id, true);
        if (!payment || payment.status !== 'paid' || payment.orderId || payment.error) return null;
        const created = await this.orders.placePaidMobile(em, payment, now);
        await em.update(MobilePayment, id, { orderId: created.id });
        return created;
      });
    } catch (error) {
      const code = errorCode(error);
      this.logger.error(`To'langan ${id} — buyurtma yaratilmadi (${code}): ${(error as Error).message}. Pulni qaytaring`);
      await this.dataSource.manager.update(MobilePayment, { id, orderId: IsNull() }, { error: code });
      return;
    }
    if (!order) return;
    this.logger.log(`To'lov ${id} → buyurtma ${order.id} (#${order.number}, filial ${order.branchId})`);
    this.orders.announce(order);
  }

  /** Kutayotgan to'lovni yopadi (to'langani — o'zgarmaydi). */
  private async close(id: string, status: 'failed' | 'expired', raw: unknown, now: Date): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const payment = await this.lock(em, id);
      if (!payment || payment.status !== 'waiting') return;
      const bank = bankRecord(raw);
      await em.update(MobilePayment, id, { status, ...(bank ? { bank } : {}), checkedAt: now });
      this.logger.log(`To'lov ${id}: ${status}`);
    });
  }

  private lock(em: EntityManager, id: string, withToken = false): Promise<MobilePayment | null> {
    const query = em.createQueryBuilder(MobilePayment, 'p').setLock('pessimistic_write').where('p.id = :id', { id });
    if (withToken) query.addSelect('p.trackingTokenHash');
    return query.getOne();
  }
}
