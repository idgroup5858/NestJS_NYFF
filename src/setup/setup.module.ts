import { Module } from '@nestjs/common';
import { SetupService } from './setup.service';

/** Yangi bazani ishga tayyorlash: birinchi admin va markaziy ombor (`SetupService`). */
@Module({
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
