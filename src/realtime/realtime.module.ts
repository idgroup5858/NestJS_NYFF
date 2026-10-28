import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Branch } from '../branches/branch.entity';
import { Order } from '../orders/order.entity';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Branch]), AuthModule],
  providers: [PresenceService, RealtimeGateway],
  exports: [PresenceService, RealtimeGateway],
})
export class RealtimeModule {}
