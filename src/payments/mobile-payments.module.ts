import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MobileCardsController } from './mobile-cards.controller';
import { MobileCardsService } from './mobile-cards.service';
import { MobilePaymentsController } from './mobile-payments.controller';
import { MobilePaymentsJobs } from './mobile-payments.jobs';
import { MobilePaymentsService } from './mobile-payments.service';
import { NbuClient } from './nbu.client';

/**
 * Mobil ilovada karta bilan to'lov va bog'langan kartalar (Milliy Ecom / NBU). Callback — `NbuCallbackModule`
 * (`/api/callback`).
 */
@Module({
  imports: [OrdersModule],
  controllers: [MobilePaymentsController, MobileCardsController],
  providers: [MobilePaymentsService, MobileCardsService, MobilePaymentsJobs, NbuClient],
  exports: [MobilePaymentsService, MobileCardsService],
})
export class MobilePaymentsModule {}
