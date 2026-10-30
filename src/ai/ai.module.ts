import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { OrdersModule } from '../orders/orders.module';
import { ReportsModule } from '../reports/reports.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiTools } from './ai.tools';
import { GeminiClient } from './gemini.client';

@Module({
  imports: [ReportsModule, ShiftsModule, ExpensesModule, OrdersModule, BranchesModule],
  controllers: [AiController],
  providers: [GeminiClient, AiTools, AiService],
  exports: [AiService],
})
export class AiModule {}
