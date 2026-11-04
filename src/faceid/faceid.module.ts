import { Module } from '@nestjs/common';
import { HrController, HrKeysController } from './faceid.controller';
import { FaceIdService } from './faceid.service';
import { HrGuard } from './hr.guard';
import { HrKeysService } from './hr-keys.service';

/**
 * FaceID (2026-11-04): filial HR tizimidan «Kirish» / «Chiqish» lar, HR kaliti, kassa tekshiruvi (smenalar va kirish
 * shu moduldan foydalanadi). Boshqa modullarga bog'lanmaydi — Telegram orqali ruxsat so'rash `FaceIdRequestsModule` da.
 */
@Module({
  controllers: [HrController, HrKeysController],
  providers: [FaceIdService, HrKeysService, HrGuard],
  exports: [FaceIdService, HrKeysService],
})
export class FaceIdModule {}
