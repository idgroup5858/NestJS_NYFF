import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MobilePaymentsController } from './mobile-payments.controller';
import { MobilePaymentsJobs } from './mobile-payments.jobs';
import { MobilePaymentsService } from './mobile-payments.service';
import { NbuClient } from './nbu.client';

/** Mobil ilovada karta bilan to'lov (Milliy Ecom / NBU). Callback — `NbuCallbackModule` (`/api/callback`). */
@Module({
  imports: [OrdersModule],
  controllers: [MobilePaymentsController],
  providers: [MobilePaymentsService, MobilePaymentsJobs, NbuClient],
  exports: [MobilePaymentsService],
})
export class MobilePaymentsModule {}
