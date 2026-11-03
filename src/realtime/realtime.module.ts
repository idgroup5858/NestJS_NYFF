import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Branch } from '../branches/branch.entity';
import { Order } from '../orders/order.entity';
import { ScreensModule } from '../screens/screens.module';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Branch]), AuthModule, ScreensModule],
  providers: [PresenceService, RealtimeGateway],
  exports: [PresenceService, RealtimeGateway],
})
export class RealtimeModule {}
