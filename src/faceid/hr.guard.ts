import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { fail } from '../common/errors';
import { HrKeysService } from './hr-keys.service';

/** HR so'rov sarlavhasi: filial kaliti `br_….<maxfiy qism>` (admin "Filiallar" → "HR kaliti"). */
export const HR_KEY_HEADER = 'x-hr-key';

type HrRequest = Request & { hrBranchId?: string };

/** Filial HR tizimi: `X-Hr-Key` — xodim tokeni emas. */
@Injectable()
export class HrGuard implements CanActivate {
  constructor(private readonly keys: HrKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HrRequest>();
    const value = request.headers[HR_KEY_HEADER];
    const key = (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
    request.hrBranchId = (key && (await this.keys.verify(key))) || fail('unauthorized', 'hr key');
    return true;
  }
}

/** Kaliti tekshirilgan filial (`HrGuard` qo'ygan). */
export const HrBranchId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest<HrRequest>().hrBranchId ?? fail('unauthorized');
});
