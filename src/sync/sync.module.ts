import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { OfflineKeysService } from './offline-keys.service';
import { OfflineKeysController, SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/**
 * Markaz tomoni: filial offline kassalari (Electron ilova) nusxa oladi va internet yo'q paytdagi buyurtmalarni yuboradi;
 * admin filial kalitini beradi.
 */
@Module({
  imports: [MenuModule, RealtimeModule, WarehouseModule],
  controllers: [SyncController, OfflineKeysController],
  providers: [SyncService, OfflineKeysService],
})
export class SyncModule {}
