import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ScreensModule } from '../screens/screens.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { KioskController, MobileController, OrdersController, TvController } from './orders.controller';
import { OrdersJobs } from './orders.jobs';
import { OrdersService } from './orders.service';

@Module({
  imports: [BranchesModule, RealtimeModule, ScreensModule, WarehouseModule],
  controllers: [OrdersController, KioskController, TvController, MobileController],
  providers: [OrdersService, OrdersJobs],
  exports: [OrdersService],
})
export class OrdersModule {}
