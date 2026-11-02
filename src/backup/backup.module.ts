import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { BackupJobs } from './backup.jobs';
import { BackupService } from './backup.service';

/** Oylik zaxira nusxa — Telegram botga (`BackupService`). */
@Module({
  imports: [TelegramModule],
  providers: [BackupService, BackupJobs],
})
export class BackupModule {}
