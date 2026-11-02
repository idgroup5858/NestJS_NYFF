import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { BackupService } from './backup.service';

/** Fon ishi. `JOBS=off` bo'lsa (testlar, seed) `ScheduleModule` ulanmaydi va bu ishlamaydi. */
@Injectable()
export class BackupJobs {
  constructor(private readonly backup: BackupService) {}

  /** Har 10 daqiqada: oy tugaganmi va uning nusxasi yuborilganmi (xatolar `tick` ichida). */
  @Interval(10 * 60_000)
  async check() {
    await this.backup.tick();
  }
}
