import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { ROLES, usesPassword, type Role } from '../common/enums';
import { fail } from '../common/errors';
import { Setting } from '../database/setting.entity';
import type { Shift } from '../shifts/shift.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { User } from '../users/user.entity';
import type { AuthUser, TokenPayload } from './auth.types';
import { comparePin, hashPin, isValidPassword, isValidPin, MAX_PIN_ATTEMPTS, normalizeEmail, PIN_LOCK_MS } from './pin';

const JWT_SECRET_SETTING = 'jwtSecret';
/** Kassa kun bo'yi ochiq turadi; blokdan chiqishda (PIN bilan) token yangilanadi. */
const TOKEN_TTL = '24h';

/** PIN bilan kiradigan rollar — ismlari ochiq kirish ro'yxatida. */
const PIN_ROLES = ROLES.filter((role) => !usesPassword(role));

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.name,
    surname: user.surname,
    role: user.role,
    branchId: user.branchId,
    email: user.email,
  };
}

export interface LoginResult {
  token: string;
  user: AuthUser;
  /** kassir uchun — kirishda ochilgan yoki davom etgan smena */
  shift: Shift | null;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private secret = '';

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    private readonly jwt: JwtService,
    private readonly shifts: ShiftsService,
  ) {}

  /** `.env` da JWT_SECRET bo'lmasa — bazada bir marta yaratilib saqlanadi. */
  async onModuleInit() {
    const fromEnv = process.env.JWT_SECRET?.trim();
    if (fromEnv) {
      this.secret = fromEnv;
      return;
    }
    const stored = await this.settings.findOneBy({ key: JWT_SECRET_SETTING });
    if (stored) {
      this.secret = stored.value;
      return;
    }
    this.secret = randomBytes(32).toString('hex');
    await this.settings.save({ key: JWT_SECRET_SETTING, value: this.secret });
  }

  /**
   * Kirish ekrani uchun: PIN bilan kiradigan faol xodimlar (ism va rol) — PIN va boshqa maydonlarsiz. Admin va kuryer
   * chiqmaydi: ular email va parol bilan kiradi ([passwordLogin]), ismlari ochiq ro'yxatda ko'rinmasin.
   */
  async staff(filter: { branchId?: string; role?: Role }): Promise<AuthUser[]> {
    if (filter.role && usesPassword(filter.role)) return [];
    const users = await this.users.find({
      where: {
        active: true,
        role: filter.role ?? In(PIN_ROLES),
        ...(filter.branchId && { branchId: filter.branchId }),
      },
      order: { name: 'ASC', surname: 'ASC' },
    });
    return users.map(toAuthUser);
  }

  /**
   * PIN bilan kirish (kassir, oshpaz yordamchisi, ta'minotchi); kassir uchun smena ochiladi yoki davom etadi. Admin va
   * kuryer bu yo'ldan kira olmaydi — rol PIN'dan oldin tekshiriladi (parol PIN sifatida sinab ko'rilmasin).
   */
  async login(userId: string, pin: string, now = new Date()): Promise<LoginResult> {
    await this.assertPinRole(userId);
    const user = await this.checkPin(userId, pin, now);
    const shift =
      user.role === 'cashier' && user.branchId ? await this.shifts.openOrResume(user.id, user.branchId, now) : null;
    return { token: await this.sign(user), user: toAuthUser(user), shift };
  }

  /**
   * Admin (web, `/admin`) va kuryer (mobil ilova) — email va parol bilan. Email topilmasa ham, parol noto'g'ri bo'lsa
   * ham — bir xil `wrong_login` (qaysi email borligi bilinmasin); ketma-ket xatolar bloki PIN'dagidek.
   */
  async passwordLogin(role: 'admin' | 'courier', email: string, password: string, now = new Date()): Promise<LoginResult> {
    const found = await this.users.findOneBy({ email: normalizeEmail(email), role });
    if (!found) fail('wrong_login');
    const user = await this.checkPin(found.id, password, now, 'wrong_login');
    return { token: await this.sign(user), user: toAuthUser(user), shift: null };
  }

  /** Kassa blokdan chiqadi — faqat shu xodimning PIN'i bilan; yangi token qaytadi. */
  async unlock(userId: string, pin: string, now = new Date()): Promise<{ token: string }> {
    await this.assertPinRole(userId);
    return { token: await this.sign(await this.checkPin(userId, pin, now)) };
  }

  /** Xodim o'z PIN'ini almashtiradi (eski PIN bilan tasdiqlab). */
  async changeOwnPin(userId: string, oldPin: string, newPin: string, now = new Date()): Promise<void> {
    await this.assertPinRole(userId);
    await this.checkPin(userId, oldPin, now);
    if (!isValidPin(newPin)) fail('invalid_pin');
    await this.users.update(userId, { pinHash: await hashPin(newPin) });
  }

  /** Admin o'z parolini almashtiradi (joriy parol bilan tasdiqlab). */
  async changePassword(userId: string, oldPassword: string, newPassword: string, now = new Date()): Promise<void> {
    await this.checkPin(userId, oldPassword, now, 'wrong_password');
    await this.setPassword(userId, newPassword);
  }

  /**
   * Yangi parol joriysini so'ramasdan — Telegram botdagi "Parolni tiklash" (bot chatni shu adminga bog'lagan). Blok va
   * xato urinishlar hisoblagichi ham tozalanadi.
   */
  async setPassword(userId: string, password: string): Promise<void> {
    if (!isValidPassword(password)) fail('invalid_password');
    await this.users.update(userId, { pinHash: await hashPin(password), failedPinAttempts: 0, pinLockedUntil: null });
  }

  /** Token → xodim. Xodim bloklangan yoki o'chirilgan bo'lsa — `null` (eski token ishlamaydi). */
  async verify(token: string): Promise<AuthUser | null> {
    try {
      const payload = await this.jwt.verifyAsync<TokenPayload>(token, { secret: this.secret });
      const user = await this.users.findOneBy({ id: payload.sub });
      return user && user.active ? toAuthUser(user) : null;
    } catch {
      return null;
    }
  }

  /**
   * PIN (admin va kuryerda — parol) tekshiruvi (tartib frontend `verifyPin` dagidek: topilmadi → bloklangan →
   * noto'g'ri). Ketma-ket 5 marta noto'g'ri — 5 daqiqa blok; to'g'ri kiritilsa hisoblagich nolga tushadi.
   */
  async checkPin(
    userId: string,
    pin: string,
    now = new Date(),
    wrong: 'wrong_pin' | 'wrong_login' | 'wrong_password' = 'wrong_pin',
  ): Promise<User> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect(['u.pinHash', 'u.failedPinAttempts', 'u.pinLockedUntil'])
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) fail('not_found', `user ${userId}`);
    if (!user.active) fail('user_inactive');
    if (user.pinLockedUntil && user.pinLockedUntil > now) {
      fail('too_many_attempts', `${Math.ceil((user.pinLockedUntil.getTime() - now.getTime()) / 1000)}s`);
    }

    if (!(await comparePin(pin, user.pinHash))) {
      // bitta SQL — bir vaqtda kelgan urinishlar ham to'g'ri sanaladi
      const [rows] = (await this.users.query(
        `UPDATE users SET
           "failedPinAttempts" = CASE WHEN "failedPinAttempts" + 1 >= $2 THEN 0 ELSE "failedPinAttempts" + 1 END,
           "pinLockedUntil" = CASE WHEN "failedPinAttempts" + 1 >= $2 THEN $3::timestamptz ELSE NULL END
         WHERE id = $1 RETURNING "pinLockedUntil"`,
        [user.id, MAX_PIN_ATTEMPTS, new Date(now.getTime() + PIN_LOCK_MS)],
      )) as [{ pinLockedUntil: Date | null }[], number];
      fail(rows[0]?.pinLockedUntil ? 'too_many_attempts' : wrong);
    }

    if (user.failedPinAttempts > 0 || user.pinLockedUntil) {
      await this.users.update(user.id, { failedPinAttempts: 0, pinLockedUntil: null });
    }
    return user;
  }

  /** PIN yo'llari (kirish, blokdan chiqish, PIN almashtirish) — admin va kuryerga emas. */
  private async assertPinRole(userId: string): Promise<void> {
    const user = (await this.users.findOneBy({ id: userId })) ?? fail('not_found', `user ${userId}`);
    if (usesPassword(user.role)) fail('forbidden', `${user.role}: email va parol bilan kiradi`);
  }

  private sign(user: User): Promise<string> {
    const payload: TokenPayload = { sub: user.id };
    return this.jwt.signAsync(payload, { secret: this.secret, expiresIn: TOKEN_TTL });
  }
}
