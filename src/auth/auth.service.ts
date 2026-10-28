import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Not, Repository } from 'typeorm';
import type { Role } from '../common/enums';
import { fail } from '../common/errors';
import { Setting } from '../database/setting.entity';
import type { Shift } from '../shifts/shift.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { User } from '../users/user.entity';
import type { AuthUser, TokenPayload } from './auth.types';
import { comparePin, hashPin, isValidPin, MAX_PIN_ATTEMPTS, normalizeLogin, PIN_LOCK_MS } from './pin';

const JWT_SECRET_SETTING = 'jwtSecret';
/** Kassa kun bo'yi ochiq turadi; blokdan chiqishda (PIN bilan) token yangilanadi. */
const TOKEN_TTL = '24h';

export function toAuthUser(user: User): AuthUser {
  return { id: user.id, name: user.name, role: user.role, branchId: user.branchId };
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
   * Kirish ekrani uchun: faol xodimlar (ism va rol) — PIN va boshqa maydonlarsiz. Kuryerlar chiqmaydi: ular login va
   * parol bilan kiradi ([courierLogin]), ismlari ochiq ro'yxatda ko'rinmasin.
   */
  async staff(filter: { branchId?: string; role?: Role }): Promise<AuthUser[]> {
    if (filter.role === 'courier') return [];
    const users = await this.users.find({
      where: {
        active: true,
        role: filter.role ?? Not('courier'),
        ...(filter.branchId && { branchId: filter.branchId }),
      },
      order: { name: 'ASC' },
    });
    return users.map(toAuthUser);
  }

  /** PIN bilan kirish (kuryerdan boshqa xodimlar); kassir uchun smena ochiladi yoki davom etadi. */
  async login(userId: string, pin: string, now = new Date()): Promise<LoginResult> {
    const user = await this.checkPin(userId, pin, now);
    if (user.role === 'courier') fail('forbidden', 'courier — /auth/courier-login');
    const shift =
      user.role === 'cashier' && user.branchId ? await this.shifts.openOrResume(user.id, user.branchId, now) : null;
    return { token: await this.sign(user), user: toAuthUser(user), shift };
  }

  /**
   * Kuryer: login va parol bilan (admin ochib bergan). Login topilmasa ham, parol noto'g'ri bo'lsa ham — bir xil
   * `wrong_login` (qaysi login borligi bilinmasin); ketma-ket xatolar bloki PIN'dagidek.
   */
  async courierLogin(login: string, password: string, now = new Date()): Promise<LoginResult> {
    const found = await this.users.findOneBy({ login: normalizeLogin(login), role: 'courier' });
    if (!found) fail('wrong_login');
    const user = await this.checkPin(found.id, password, now, 'wrong_login');
    return { token: await this.sign(user), user: toAuthUser(user), shift: null };
  }

  /** Kassa blokdan chiqadi — faqat shu xodimning PIN'i bilan; yangi token qaytadi. */
  async unlock(userId: string, pin: string, now = new Date()): Promise<{ token: string }> {
    return { token: await this.sign(await this.checkPin(userId, pin, now)) };
  }

  /** Xodim o'z PIN'ini almashtiradi (eski PIN bilan tasdiqlab). */
  async changeOwnPin(userId: string, oldPin: string, newPin: string, now = new Date()): Promise<void> {
    await this.checkPin(userId, oldPin, now);
    if (!isValidPin(newPin)) fail('invalid_pin');
    await this.users.update(userId, { pinHash: await hashPin(newPin) });
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
   * PIN (kuryerda — parol) tekshiruvi (tartib frontend `verifyPin` dagidek: topilmadi → bloklangan → noto'g'ri).
   * Ketma-ket 5 marta noto'g'ri — 5 daqiqa blok; to'g'ri kiritilsa hisoblagich nolga tushadi.
   */
  async checkPin(userId: string, pin: string, now = new Date(), wrong: 'wrong_pin' | 'wrong_login' = 'wrong_pin'): Promise<User> {
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

  private sign(user: User): Promise<string> {
    const payload: TokenPayload = { sub: user.id };
    return this.jwt.signAsync(payload, { secret: this.secret, expiresIn: TOKEN_TTL });
  }
}
