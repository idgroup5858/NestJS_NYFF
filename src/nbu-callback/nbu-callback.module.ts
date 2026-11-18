import { Module } from '@nestjs/common';
import { MobilePaymentsModule } from '../payments/mobile-payments.module';
import { NbuCallbackController } from './nbu-callback.controller';
import { NbuCallbackService } from './nbu-callback.service';
import { NbuAuthGuard } from './nbu-auth.guard';

@Module({
  imports: [MobilePaymentsModule],
  controllers: [NbuCallbackController],
  providers: [NbuCallbackService, NbuAuthGuard],
})
export class NbuCallbackModule {}
