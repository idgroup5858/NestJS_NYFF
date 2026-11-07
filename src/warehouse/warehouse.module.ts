import { Module } from '@nestjs/common';
import { LowStockEvents } from './low-stock-events';
import { PurchaseEvents } from './purchase-events';
import { StockService } from './stock.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  controllers: [WarehouseController],
  providers: [StockService, WarehouseService, LowStockEvents, PurchaseEvents],
  exports: [StockService, WarehouseService, LowStockEvents, PurchaseEvents],
})
export class WarehouseModule {}
