import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../common/enums';
import { fail } from '../common/errors';
import { AuthService } from './auth.service';
import type { AuthedRequest } from './auth.types';
import { IS_PUBLIC, ROLES } from './decorators';

/**
 * Global guard (barcha controllerlar, `@Public()` dan tashqari): xodim — `Authorization: Bearer <token>` (PIN bilan
 * kirgandan keyin), `@Roles()` bo'lsa — rol tekshiriladi. TV va kiosk endpointlari — `@Public()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
    if (meta<boolean>(IS_PUBLIC)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const roles = meta<Role[]>(ROLES);
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const user = (token && (await this.auth.verify(token))) || fail('unauthorized');
    if (roles && !roles.includes(user.role)) fail('forbidden', user.role);
    request.user = user;
    return true;
  }
}
