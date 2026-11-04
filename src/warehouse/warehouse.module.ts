import { Module } from '@nestjs/common';
import { LowStockEvents } from './low-stock-events';
import { StockService } from './stock.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  controllers: [WarehouseController],
  providers: [StockService, WarehouseService, LowStockEvents],
  exports: [StockService, WarehouseService, LowStockEvents],
})
export class WarehouseModule {}
