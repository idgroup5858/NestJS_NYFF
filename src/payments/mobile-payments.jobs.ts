import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MobileCardsService } from './mobile-cards.service';
import { MobilePaymentsService } from './mobile-payments.service';

/** Fon ishi. `JOBS=off` bo'lsa (testlar) ishlamaydi — testda `sweep()` qo'lda chaqiriladi. */
@Injectable()
export class MobilePaymentsJobs {
  private readonly logger = new Logger('MobilePaymentsJobs');
  private running = false;

  constructor(
    private readonly payments: MobilePaymentsService,
    private readonly cards: MobileCardsService,
  ) {}

  /** Callback kelmay qolgan to'lovlarni bankdan so'rash, muddati o'tganlarini yopish; eski bog'lanmagan kartalar. */
  @Interval(30_000)
  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      await this.payments.sweep();
      await this.cards.cleanup();
    } catch (error) {
      this.logger.error((error as Error).message);
    } finally {
      this.running = false;
    }
  }
}
