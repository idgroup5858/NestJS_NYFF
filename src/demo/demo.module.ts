import { Module } from '@nestjs/common';
import { ExpensesModule } from '../expenses/expenses.module';
import { OrdersModule } from '../orders/orders.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

/** Demo ma'lumot (frontend `seed.ts` + `history.ts`): bo'sh bazaga avtomatik, `POST /api/demo/reset`, `npm run seed`. */
@Module({
  imports: [OrdersModule, ShiftsModule, WarehouseModule, ExpensesModule],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
