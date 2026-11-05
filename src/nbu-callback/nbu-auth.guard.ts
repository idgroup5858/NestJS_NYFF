// nbu-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class NbuAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];

    if (!authHeader?.startsWith('Basic ')) {
      throw new UnauthorizedException();
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const username = decoded.slice(0, i);
    const password = decoded.slice(i + 1);

    const expectedUser = process.env.NBU_CALLBACK_USERNAME;
    const expectedPass = process.env.NBU_CALLBACK_PASSWORD;
    if (!expectedUser || !expectedPass) {
      throw new Error('NBU callback credentials are not configured');
    }

    if (i < 0 || username !== expectedUser || password !== expectedPass) {
      throw new UnauthorizedException();
    }
    return true;
  }
}