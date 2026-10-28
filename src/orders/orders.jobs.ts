import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OrdersService } from './orders.service';

/** Fon ishlari. `JOBS=off` bo'lsa (testlar, seed) `ScheduleModule` ulanmaydi va bular ishlamaydi. */
@Injectable()
export class OrdersJobs {
  private readonly logger = new Logger('OrdersJobs');
  private running = false;

  constructor(private readonly orders: OrdersService) {}

  /** Qabul qilinmagan mobil buyurtmalar: 5 daqiqa yoki filial yopildi → boshqa filialga / bekor. */
  @Interval(30_000)
  async expirePendingMobile() {
    if (this.running) return;
    this.running = true;
    try {
      const changed = await this.orders.expirePendingMobile();
      if (changed) this.logger.log(`Qabul qilinmagan mobil buyurtmalar: ${changed} ta o'tkazildi / bekor qilindi`);
    } catch (error) {
      this.logger.error((error as Error).message);
    } finally {
      this.running = false;
    }
  }
}
