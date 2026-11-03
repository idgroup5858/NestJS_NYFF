import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Public, Roles } from '../auth/decorators';
import { OfflineKeysService } from './offline-keys.service';
import { SnapshotQuery, SyncOrdersDto } from './sync.dto';
import { SyncBranchId, SyncGuard } from './sync.guard';
import { SyncService } from './sync.service';

/**
 * Filial offline kassasi uchun (Electron ilova, kassa kompyuterida). Xodim tokeni emas — filial kaliti
 * (`x-offline-key`, admin "Filiallar" → "Offline kalit").
 */
@Public()
@UseGuards(SyncGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('snapshot')
  snapshot(@SyncBranchId() branchId: string, @Query() query: SnapshotQuery) {
    return this.sync.snapshot(branchId, query.since);
  }

  @Post('orders')
  @HttpCode(200)
  orders(@SyncBranchId() branchId: string, @Body() dto: SyncOrdersDto) {
    return this.sync.importOrders(branchId, dto.orders);
  }
}

/** Admin: filialning offline kaliti — ko'rish (yo'q bo'lsa yaratiladi) va yangilash (eskisi ishlamay qoladi). */
@Roles('admin')
@Controller('branches')
export class OfflineKeysController {
  constructor(private readonly keys: OfflineKeysService) {}

  @Get(':id/offline-key')
  async get(@Param('id') id: string) {
    return { key: await this.keys.get(id) };
  }

  @Post(':id/offline-key')
  @HttpCode(200)
  async regenerate(@Param('id') id: string) {
    return { key: await this.keys.regenerate(id) };
  }
}
