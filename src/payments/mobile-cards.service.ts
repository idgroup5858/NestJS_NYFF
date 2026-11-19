import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, LessThan } from 'typeorm';
import { fail } from '../common/errors';
import { sha256 } from '../common/ids';
import { uuidv7 } from '../nbu-test/nbu-crypto';
import { mobileCardConfig, RETURN_PATH } from './mobile-card.config';
import { MobileCard } from './mobile-card.entity';
import { NbuClient, readNbuCardBinding } from './nbu.client';

/** Ilova o'zi yaratgan maxfiy kalit sarlavhasi — karta shu telefonga bog'lanadi. */
export const CLIENT_KEY_HEADER = 'x-client-key';

/** Ilovaga ko'rinadigan karta — tokensiz. */
export interface MobileCardView {
  id: string;
  /** `9860********4764`; bank bermagan bo'lsa — `null` */
  maskedPan: string | null;
  createdAt: Date;
}

export interface MobileCardBindingView {
  id: string;
  status: MobileCard['status'];
  card: MobileCardView | null;
}

const cardView = (card: MobileCard): MobileCardView => ({ id: card.id, maskedPan: card.maskedPan, createdAt: card.createdAt });

/** Bog'lanmagan (bank sahifasi tashlab ketilgan / rad etilgan) yozuvlar shuncha vaqtdan keyin o'chiriladi. */
const STALE_BINDING_MS = 24 * 60 * 60_000;

/** Kalit: ilova yaratgan tasodifiy satr (base64url, 32 bayt → 43 belgi). Bo'lmasa / noto'g'ri — `unauthorized`. */
export function clientKeyHash(key: string | undefined): string {
  const clean = key?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(clean)) fail('unauthorized', 'X-Client-Key');
  return sha256(clean);
}

/** Bankka ketadigan mijoz id'si (`clientId`) — kalitning o'zi emas, xeshidan qisqa belgi. */
export const bankClientId = (hash: string) => `cl_${hash.slice(0, 24)}`;

/**
 * Bog'langan kartalar (Milliy Ecom `/payment/bind`, `/payment/unbind`). Tartib: ilova `POST /mobile/cards/bind` →
 * bank sahifasi (WebView, pul yechilmaydi) → bank callback'i `purpose: CARD_BINDING` (`cardToken`, `maskedPan`) → karta
 * `active`. Saqlangan kartadan to'lov — `MobilePaymentsService` (`cardId`).
 */
@Injectable()
export class MobileCardsService {
  private readonly logger = new Logger('MobileCards');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly nbu: NbuClient,
  ) {}

  /** Telefonning bog'langan kartalari, yangisi birinchi. */
  async list(key: string | undefined): Promise<MobileCardView[]> {
    const hash = clientKeyHash(key);
    const cards = await this.dataSource.manager.find(MobileCard, {
      where: { clientKeyHash: hash, status: 'active' },
      order: { boundAt: 'DESC', createdAt: 'DESC' },
    });
    return cards.map(cardView);
  }

  /**
   * Bog'lashni boshlash: bankda sessiya ochiladi, javobda bank sahifasi (`paymentUrl`) va qaytish manzili (`returnUrl`
   * — ilova ushlaydi). [origin] — ilova murojaat qilgan manzil (`PUBLIC_URL` bo'lsa — o'sha).
   */
  async startBinding(
    key: string | undefined,
    origin: string | null,
    now = new Date(),
  ): Promise<{ binding: MobileCardBindingView; paymentUrl: string; returnUrl: string }> {
    const hash = clientKeyHash(key);
    const config = mobileCardConfig() ?? fail('card_unavailable');
    const base = config.publicUrl ?? origin ?? fail('card_unavailable', 'server manzili aniqlanmadi');
    const id = uuidv7();
    const returnUrl = `${base}${RETURN_PATH}`;
    let bank: { paymentUrl: string };
    try {
      bank = await this.nbu.bind({
        orderId: id,
        clientId: bankClientId(hash),
        successUrl: `${returnUrl}?result=success&id=${id}`,
        failureUrl: `${returnUrl}?result=failure&id=${id}`,
        sessionTimeout: config.sessionSeconds,
      });
    } catch (error) {
      this.logger.error(`Bog'lash ochilmadi (${id}): ${(error as Error).message}`);
      fail('card_unavailable');
    }
    const card: MobileCard = {
      id,
      clientKeyHash: hash,
      status: 'pending',
      cardToken: null,
      maskedPan: null,
      createdAt: now,
      boundAt: null,
    };
    await this.dataSource.manager.insert(MobileCard, card);
    this.logger.log(`Bog'lash ochildi: ${id}, qaytish — ${returnUrl}`);
    return { binding: { id, status: 'pending', card: null }, paymentUrl: bank.paymentUrl, returnUrl };
  }

  /** Bog'lash natijasi — ilova bank sahifasi yopilgandan keyin so'raydi (token callback bilan keladi). */
  async binding(key: string | undefined, id: string): Promise<MobileCardBindingView> {
    const hash = clientKeyHash(key);
    const card = (await this.dataSource.manager.findOneBy(MobileCard, { id, clientKeyHash: hash })) ?? fail('not_found', `card ${id}`);
    return { id: card.id, status: card.status, card: card.status === 'active' ? cardView(card) : null };
  }

  /** Kartani o'chirish: bankda uziladi (bank xatosi — faqat logda), bazadan o'chadi — boshqa ishlatilmaydi. */
  async remove(key: string | undefined, id: string): Promise<void> {
    const hash = clientKeyHash(key);
    const card = await this.dataSource.manager
      .createQueryBuilder(MobileCard, 'c')
      .addSelect('c.cardToken')
      .where('c.id = :id AND c.clientKeyHash = :hash', { id, hash })
      .getOne();
    if (!card) fail('not_found', `card ${id}`);
    if (card.cardToken) {
      try {
        await this.nbu.unbind({ clientId: bankClientId(hash), cardToken: card.cardToken });
      } catch (error) {
        this.logger.warn(`Karta ${id} bankda uzilmadi: ${(error as Error).message} — bazadan baribir o'chirildi`);
      }
    }
    await this.dataSource.manager.delete(MobileCard, { id });
    this.logger.log(`Karta o'chirildi: ${id} (${card.maskedPan ?? '—'})`);
  }

  /** Saqlangan kartadan to'lov uchun: shu telefonning faol kartasi va tokeni. */
  async tokenFor(key: string | undefined, id: string): Promise<{ cardId: string; cardToken: string; maskedPan: string | null }> {
    const hash = clientKeyHash(key);
    const card = await this.dataSource.manager
      .createQueryBuilder(MobileCard, 'c')
      .addSelect('c.cardToken')
      .where("c.id = :id AND c.clientKeyHash = :hash AND c.status = 'active'", { id, hash })
      .getOne();
    if (!card?.cardToken) fail('not_found', `card ${id}`);
    return { cardId: card.id, cardToken: card.cardToken, maskedPan: card.maskedPan };
  }

  /**
   * Bank callback'i `purpose: CARD_BINDING`. Shu telefonda xuddi shu token allaqachon bo'lsa (karta qayta bog'landi) —
   * yangi yozuv o'chiriladi, eskisi qoladi.
   */
  async handleCallback(body: unknown, now = new Date()): Promise<void> {
    const info = readNbuCardBinding(body);
    if (!info.orderId) {
      this.logger.warn("Bog'lash callback'ida orderId yo'q");
      return;
    }
    await this.dataSource.transaction(async (em) => {
      const card = await em
        .createQueryBuilder(MobileCard, 'c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: info.orderId })
        .getOne();
      if (!card) {
        this.logger.log(`Bog'lash callback'i: ${info.orderId} — bizda yo'q (test sahifasi?), e'tiborsiz`);
        return;
      }
      if (card.status === 'active') return;
      if (info.state === 'failed') {
        await em.update(MobileCard, card.id, { status: 'failed' });
        this.logger.log(`Karta bog'lanmadi: ${card.id}`);
        return;
      }
      if (info.state !== 'success' || !info.cardToken) {
        if (info.state === 'success') this.logger.warn(`Bog'lash ${card.id}: SUCCESS, lekin cardToken yo'q`);
        return;
      }
      const same = await em
        .createQueryBuilder(MobileCard, 'c')
        .where("c.clientKeyHash = :hash AND c.status = 'active' AND c.cardToken = :token", {
          hash: card.clientKeyHash,
          token: info.cardToken,
        })
        .getOne();
      if (same) {
        await em.delete(MobileCard, { id: card.id });
        this.logger.log(`Karta ${info.maskedPan ?? ''} shu telefonda allaqachon bor (${same.id}) — takror yozilmadi`);
        return;
      }
      await em.update(MobileCard, card.id, {
        status: 'active',
        cardToken: info.cardToken,
        maskedPan: info.maskedPan,
        boundAt: now,
      });
      this.logger.log(`Karta bog'landi: ${card.id} (${info.maskedPan ?? '—'})`);
    });
  }

  /** Fon ishi: bir kundan eski bog'lanmagan yozuvlar. */
  async cleanup(now = new Date()): Promise<number> {
    const result = await this.dataSource.manager.delete(MobileCard, {
      status: In(['pending', 'failed']),
      createdAt: LessThan(new Date(now.getTime() - STALE_BINDING_MS)),
    });
    return result.affected ?? 0;
  }
}
