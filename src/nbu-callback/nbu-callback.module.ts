import { Module } from '@nestjs/common';
import { NbuCallbackController } from './nbu-callback.controller';
import { NbuCallbackService } from './nbu-callback.service';
import { NbuAuthGuard } from './nbu-auth.guard';

@Module({
  controllers: [NbuCallbackController],
  providers: [NbuCallbackService, NbuAuthGuard],
})
export class NbuCallbackModule {}