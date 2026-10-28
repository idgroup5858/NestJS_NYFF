import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CourierController } from './courier.controller';
import { CourierService } from './courier.service';

@Module({
  imports: [RealtimeModule],
  controllers: [CourierController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
