import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { TelegramApi } from './telegram.api';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [AiModule],
  controllers: [TelegramController],
  providers: [TelegramApi, TelegramService],
})
export class TelegramModule {}
