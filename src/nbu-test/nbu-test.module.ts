import { Module } from '@nestjs/common';
import { NbuTestController } from './nbu-test.controller';
import { NbuTestService } from './nbu-test.service';

/** Milliy Ecom (NBU) API sinovi — mustaqil: baza, boshqa modullar va `/api/callback` bilan bog'liq emas. */
@Module({
  controllers: [NbuTestController],
  providers: [NbuTestService],
})
export class NbuTestModule {}
