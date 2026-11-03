import type { Request } from 'express';
import type { Role } from '../common/enums';

/** Kirgan xodim — har so'rovda bazadan yangidan olinadi (bloklansa yoki roli o'zgarsa darhol kuchga kiradi). */
export interface AuthUser {
  id: string;
  name: string;
  surname: string;
  role: Role;
  /**
   * Joriy filial — kassir va oshpaz yordamchisi PIN bilan kirganda kassa turgan filial (tokenda); buyurtma, smena va
   * socket xonasi shu filialniki. Admin, ta'minotchi va kuryer — `null`.
   */
  branchId: string | null;
  /** xodim ishlaydigan barcha filiallar (kassir, oshpaz yordamchisi); boshqalarda — `[]` */
  branchIds: string[];
  /** admin va kuryer — kirish emaili; PIN bilan kiradiganlarda `null` */
  email: string | null;
}

export interface TokenPayload {
  sub: string;
  /**
   * Joriy filial (kassir, oshpaz yordamchisi). 2026-11-04 dan oldingi tokenlarda yo'q — xodimning bitta filiali bo'lsa
   * o'shanisi olinadi, bir nechta bo'lsa qayta kirish kerak.
   */
  branchId?: string;
}

export type AuthedRequest = Request & { user?: AuthUser };
