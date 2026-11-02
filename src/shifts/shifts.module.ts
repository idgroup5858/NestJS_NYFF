import { Module } from '@nestjs/common';
import { ShiftEvents } from './shift-events';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftEvents],
  exports: [ShiftsService, ShiftEvents],
})
export class ShiftsModule {}
