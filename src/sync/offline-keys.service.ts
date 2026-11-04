import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BranchKeys } from '../common/branch-keys';

/** `settings` jadvalidagi kalit: `offline_key:br_…` → maxfiy qism. */
export const offlineKeySetting = (branchId: string) => `offline_key:${branchId}`;

/**
 * Filial offline kassasi (Electron ilova, kassa kompyuterida) kaliti: `br_….<maxfiy qism>` (umumiy qoidalar —
 * `BranchKeys`).
 */
@Injectable()
export class OfflineKeysService extends BranchKeys {
  protected readonly prefix = 'offline_key';

  constructor(@InjectDataSource() dataSource: DataSource) {
    super(dataSource);
  }
}
