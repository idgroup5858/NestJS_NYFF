import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Sotuv hisoboti (frontend `salesReport` — SQL agregatlar bilan) va admin bosh sahifasi ko'rsatkichlari. */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
