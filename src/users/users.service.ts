import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { hashPin, isValidEmail, isValidPassword, isValidPin, normalizeEmail } from '../auth/pin';
import { Branch } from '../branches/branch.entity';
import { roleNeedsBranch, usesPassword } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { assertUnused } from '../common/in-use';
import { Revocations } from '../common/revocations';
import { Setting } from '../database/setting.entity';
import { Order } from '../orders/order.entity';
import { SaveUserDto } from './user.dto';
import { User } from './user.entity';

/** Kuryer va hozirgi holati (`GET /users/couriers`). */
export interface CourierStatus {
  id: string;
  name: string;
  surname: string;
  /** bloklanmagan */
  active: boolean;
  /** ilovada "Ishdaman" yoqilgan */
  onDuty: boolean;
  /** qo'ldagi buyurtmalar: olgan, hali yetkazmagan va qaytarmagan */
  orders: number;
  /** qo'ldagi buyurtmalar filiali (bir vaqtda bittasi); bo'sh qo'l — `null` */
  branchId: string | null;
  /** "Yo'lga chiqdim" bosgan */
  departed: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly revocations: Revocations,
  ) {}

  findAll() {
    return this.users.find({ order: { createdAt: 'ASC' } });
  }

  /**
   * Kuryerlar va hozirgi holati (admin "Xodimlar", kassa "Dostavka"; bloklanganlari ham — eski buyurtmalarda ismi
   * chiqsin): "Ishdaman", qo'ldagi buyurtmalar (olgan, hali yetkazmagan / qaytarmagan), qaysi filialdan, yo'ldami.
   */
  async couriers(): Promise<CourierStatus[]> {
    const rows = await this.users.find({
      where: { role: 'courier' },
      select: { id: true, name: true, surname: true, active: true, onDuty: true },
      order: { name: 'ASC', surname: 'ASC' },
    });
    const held =
      rows.length === 0
        ? []
        : await this.orders.find({
            where: {
              courierId: In(rows.map((row) => row.id)),
              deliveredAt: IsNull(),
              returnedAt: IsNull(),
              status: In(['preparing', 'ready']),
            },
            select: { id: true, courierId: true, branchId: true, departedAt: true },
          });
    return rows.map(({ id, name, surname, active, onDuty }) => {
      const mine = held.filter((order) => order.courierId === id);
      return {
        id,
        name,
        surname,
        active,
        onDuty,
        orders: mine.length,
        branchId: mine[0]?.branchId ?? null,
        departed: mine.some((order) => order.departedAt !== null),
      };
    });
  }

  /**
   * Admin xodim qo'shadi ([id] yo'q) yoki tahrirlaydi. Ism va familiya majburiy. O'zini bloklay olmaydi va o'z rolini
   * o'zgartira olmaydi — tizimda admin qolmay qolmasin. Kassir va oshpaz yordamchisi filialga bog'lanadi. Admin va
   * kuryer — email (takrorlanmaydi) va parol bilan, boshqalar — PIN bilan; shu ikki tur o'rtasida o'tganda yangisi
   * majburiy (eski PIN parol bo'lib yoki parol PIN bo'lib qolmasin).
   */
  async save(input: SaveUserDto & { id?: string }, actorId: string, now = new Date()): Promise<User> {
    const name = input.name.trim();
    if (!name) fail('name_required');
    const surname = (input.surname ?? '').trim();
    if (!surname) fail('surname_required');
    const needsBranch = roleNeedsBranch(input.role);
    if (needsBranch && !input.branchId) fail('branch_required');
    if (needsBranch && !(await this.branches.existsBy({ id: input.branchId ?? '' }))) {
      fail('not_found', `branch ${input.branchId}`);
    }
    const branchId = needsBranch ? (input.branchId ?? null) : null;
    const password = usesPassword(input.role);
    const email = password ? this.cleanEmail(input.email ?? '') : null;
    const secret = password ? (input.password ?? '') : (input.pin ?? '').trim();
    const secretValid = password ? isValidPassword(secret) : isValidPin(secret);
    const secretError = password ? 'invalid_password' : 'invalid_pin';

    if (input.id) {
      const current = (await this.users.findOneBy({ id: input.id })) ?? fail('not_found', `user ${input.id}`);
      if (current.id === actorId && (!input.active || input.role !== current.role)) fail('self_action');
      const kindChanged = usesPassword(current.role) !== password;
      if ((secret || kindChanged) && !secretValid) fail(secretError);
      if (email && (await this.emailTaken(email, current.id))) fail('email_taken');
      const patch: Partial<User> = { name, surname, role: input.role, branchId, email, active: input.active };
      if (secret) patch.pinHash = await hashPin(secret);
      await this.uniqueEmail(() => this.users.update(current.id, patch));
      // bloklandi yoki boshqa rol / filialga o'tdi — ochiq socket ulanishlari uziladi (qayta ulansa — yangi xonaga)
      if (!input.active || input.role !== current.role || branchId !== current.branchId) this.revocations.user(current.id);
      return (await this.users.findOneBy({ id: current.id }))!;
    }

    if (!secretValid) fail(secretError);
    if (email && (await this.emailTaken(email))) fail('email_taken');
    const id = newId('usr');
    const pinHash = await hashPin(secret);
    await this.uniqueEmail(() =>
      this.users.insert({ id, name, surname, role: input.role, branchId, email, pinHash, active: input.active, createdAt: now }),
    );
    return (await this.users.findOneBy({ id }))!;
  }

  /** Admin "Profil": o'z ismi, familiyasi va emaili (parol — `AuthService.changePassword`). */
  async updateProfile(userId: string, input: { name: string; surname: string; email: string }): Promise<User> {
    const name = input.name.trim();
    if (!name) fail('name_required');
    const surname = input.surname.trim();
    if (!surname) fail('surname_required');
    const email = this.cleanEmail(input.email);
    if (await this.emailTaken(email, userId)) fail('email_taken');
    await this.uniqueEmail(() => this.users.update(userId, { name, surname, email }));
    return (await this.users.findOneBy({ id: userId })) ?? fail('not_found', `user ${userId}`);
  }

  /**
   * Xodimni o'chirish — faqat hech qayerda izi bo'lmasa (buyurtma, smena, yetkazish, kirim / ko'chirish, chiqim);
   * aks holda `in_use` — bloklash kerak (tarixda ismi qoladi). O'zini o'chira olmaydi. Telegram chatlari va AI xotirasi
   * u bilan birga o'chadi.
   */
  async remove(id: string, actorId: string): Promise<void> {
    if (id === actorId) fail('self_action');
    await this.users.manager.transaction(async (em) => {
      if (!(await em.existsBy(User, { id }))) fail('not_found', `user ${id}`);
      await assertUnused(em, id, {
        orders: `SELECT 1 FROM orders WHERE "cashierId" = $1 LIMIT 1`,
        deliveries: `SELECT 1 FROM orders WHERE "courierId" = $1 LIMIT 1`,
        cancellations: `SELECT 1 FROM orders WHERE "cancelledBy" = $1 LIMIT 1`,
        shifts: `SELECT 1 FROM shifts WHERE "cashierId" = $1 LIMIT 1`,
        purchases: `SELECT 1 FROM purchases WHERE "createdBy" = $1 OR "decidedBy" = $1 LIMIT 1`,
        transfers: `SELECT 1 FROM transfers WHERE "createdBy" = $1 LIMIT 1`,
        expenses: `SELECT 1 FROM expenses WHERE "createdBy" = $1 LIMIT 1`,
      });
      // Telegram start linki (`settings`) — chatlar va AI xotirasi FK bilan o'zi o'chadi
      await em.delete(Setting, { key: `telegram_link:${id}` });
      await em.delete(User, { id });
    });
    this.revocations.user(id);
  }

  private cleanEmail(raw: string): string {
    const email = normalizeEmail(raw);
    if (!isValidEmail(email)) fail('invalid_email');
    return email;
  }

  private emailTaken(email: string, exceptId?: string): Promise<boolean> {
    return this.users.existsBy({ email, ...(exceptId && { id: Not(exceptId) }) });
  }

  /** Bir vaqtda ikki so'rov bir xil email bersa — bazadagi unique indeks ushlaydi. */
  private async uniqueEmail<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof QueryFailedError && (error as QueryFailedError & { code?: string }).code === '23505') {
        fail('email_taken');
      }
      throw error;
    }
  }
}
