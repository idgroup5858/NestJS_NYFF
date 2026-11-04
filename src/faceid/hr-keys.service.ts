import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BranchKeys } from '../common/branch-keys';

/** `settings` jadvalidagi kalit: `hr_key:br_…` → maxfiy qism. */
export const hrKeySetting = (branchId: string) => `hr_key:${branchId}`;

/**
 * Filial HR tizimi (FaceID davomat, kassir kompyuterida) kaliti: `br_….<maxfiy qism>` — HR terminaldagi «Kirish» /
 * «Chiqish» larni shu kalit bilan yuboradi (`X-Hr-Key`), filial kalitdan bilinadi. Offline kassa kalitidan alohida.
 */
@Injectable()
export class HrKeysService extends BranchKeys {
  protected readonly prefix = 'hr_key';

  constructor(@InjectDataSource() dataSource: DataSource) {
    super(dataSource);
  }
}
