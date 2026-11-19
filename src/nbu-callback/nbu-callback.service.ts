import { Injectable, Logger } from '@nestjs/common';
import { MobileCardsService } from '../payments/mobile-cards.service';
import { MobilePaymentsService } from '../payments/mobile-payments.service';

@Injectable()
export class NbuCallbackService {
  private readonly logger = new Logger(NbuCallbackService.name);

  constructor(
    private readonly payments: MobilePaymentsService,
    private readonly cards: MobileCardsService,
  ) {}

  /**
   * Kelgan tana to'liq logga yoziladi (bank shakli tekshirish uchun), keyin: `purpose: CARD_BINDING` — karta bog'lash,
   * qolgani (`ONE_TIME_PAYMENT`, `CHARGE`) — mobil to'lov. Bizda yo'q `orderId` (test sahifasi) — faqat log.
   */
  async process(body: Record<string, unknown>): Promise<void> {
    this.logger.log(`Callback: ${JSON.stringify(body)}`);
    if (body.purpose === 'CARD_BINDING') await this.cards.handleCallback(body);
    else await this.payments.handleCallback(body);
  }
}
