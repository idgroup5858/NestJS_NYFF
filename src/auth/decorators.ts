import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../common/enums';
import { fail } from '../common/errors';
import type { AuthedRequest, AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Tokensiz ochiq endpoint (kirish ekrani, TV, kiosk, mobil ilova). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Faqat shu rollardagi xodim. Berilmasa — istalgan kirgan xodim. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Kirgan xodim (guard qo'ygan). */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthedRequest>().user;
  return user ?? fail('unauthorized');
});
