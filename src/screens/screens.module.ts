import { Module } from '@nestjs/common';
import { ScreenCodesController } from './screen-codes.controller';
import { ScreenCodesService } from './screen-codes.service';

/**
 * Filialning zal ekranlari kodlari (TV, kiosk): admin beradi; TV navbati va kiosk buyurtmasi (buyurtmalar modulida) va
 * TV socket'i (realtime) shu kod bilan ochiladi. Faqat bazaga va `Revocations` ga bog'liq — buyurtmalar va realtime
 * modullari aylanasiz ishlatadi.
 */
@Module({
  controllers: [ScreenCodesController],
  providers: [ScreenCodesService],
  exports: [ScreenCodesService],
})
export class ScreensModule {}
