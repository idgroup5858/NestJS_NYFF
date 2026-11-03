import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { fail } from '../common/errors';
import { OfflineKeysService } from './offline-keys.service';
import { SYNC_KEY_HEADER } from './sync.types';

type SyncRequest = Request & { syncBranchId?: string };

/** Filial offline kassasi: `x-offline-key: br_….<maxfiy qism>` (admin "Filiallar" da beradi) — xodim tokeni emas. */
@Injectable()
export class SyncGuard implements CanActivate {
  constructor(private readonly keys: OfflineKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SyncRequest>();
    const value = request.headers[SYNC_KEY_HEADER];
    const key = (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
    request.syncBranchId = (key && (await this.keys.verify(key))) || fail('unauthorized', 'offline key');
    return true;
  }
}

/** Kaliti tekshirilgan filial (`SyncGuard` qo'ygan). */
export const SyncBranchId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest<SyncRequest>().syncBranchId ?? fail('unauthorized');
});
