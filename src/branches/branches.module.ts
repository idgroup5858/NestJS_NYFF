import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { BranchesController, DeliveryController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [RealtimeModule],
  controllers: [BranchesController, DeliveryController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
