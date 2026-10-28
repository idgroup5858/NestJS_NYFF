import { Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  controllers: [WarehouseController],
  providers: [StockService, WarehouseService],
  exports: [StockService, WarehouseService],
})
export class WarehouseModule {}
