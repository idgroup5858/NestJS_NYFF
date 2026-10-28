import type { Request } from 'express';
import type { Role } from '../common/enums';

/** Kirgan xodim — har so'rovda bazadan yangidan olinadi (bloklansa yoki roli o'zgarsa darhol kuchga kiradi). */
export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  branchId: string | null;
}

export interface TokenPayload {
  sub: string;
}

export type AuthedRequest = Request & { user?: AuthUser };
