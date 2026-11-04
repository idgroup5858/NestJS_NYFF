import { Module } from '@nestjs/common';
import { FaceIdModule } from '../faceid/faceid.module';
import { ShiftEvents } from './shift-events';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [FaceIdModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftEvents],
  exports: [ShiftsService, ShiftEvents],
})
export class ShiftsModule {}
