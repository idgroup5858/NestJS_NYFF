import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { BranchesController, DeliveryController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [RealtimeModule, WarehouseModule],
  controllers: [BranchesController, DeliveryController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
