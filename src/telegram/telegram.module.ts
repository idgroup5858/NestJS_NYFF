import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { TelegramApi } from './telegram.api';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [AiModule, ShiftsModule],
  controllers: [TelegramController],
  providers: [TelegramApi, TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
