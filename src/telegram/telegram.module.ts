import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { FaceIdModule } from '../faceid/faceid.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { TelegramApi } from './telegram.api';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [AiModule, AuthModule, ShiftsModule, FaceIdModule, WarehouseModule],
  controllers: [TelegramController],
  providers: [TelegramApi, TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
