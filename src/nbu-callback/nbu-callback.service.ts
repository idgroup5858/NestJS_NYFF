import { Injectable, Logger } from '@nestjs/common';
import { MobilePaymentsService } from '../payments/mobile-payments.service';

@Injectable()
export class NbuCallbackService {
  private readonly logger = new Logger(NbuCallbackService.name);

  constructor(private readonly payments: MobilePaymentsService) {}

  /**
   * Kelgan tana to'liq logga yoziladi (bank shakli hali haqiqiy to'lovda ko'rilmagan — tekshirish uchun), keyin mobil
   * to'lovga qo'llanadi. Bizda yo'q `orderId` (test sahifasidagi to'lov) — faqat log.
   */
  async process(body: Record<string, unknown>): Promise<void> {
    this.logger.log(`Callback: ${JSON.stringify(body)}`);
    await this.payments.handleCallback(body);
  }
}
