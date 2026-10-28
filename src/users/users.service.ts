import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { hashPin, isValidLogin, isValidPassword, isValidPin, normalizeLogin } from '../auth/pin';
import { Branch } from '../branches/branch.entity';
import { roleNeedsBranch } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { Revocations } from '../common/revocations';
import { Order } from '../orders/order.entity';
import { SaveUserDto } from './user.dto';
import { User } from './user.entity';

/** Kuryer va hozirgi holati (`GET /users/couriers`). */
export interface CourierStatus {
  id: string;
  name: string;
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
      select: { id: true, name: true, active: true, onDuty: true },
      order: { name: 'ASC' },
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
    return rows.map(({ id, name, active, onDuty }) => {
      const mine = held.filter((order) => order.courierId === id);
      return {
        id,
        name,
        active,
        onDuty,
        orders: mine.length,
        branchId: mine[0]?.branchId ?? null,
        departed: mine.some((order) => order.departedAt !== null),
      };
    });
  }

  /**
   * Admin xodim qo'shadi ([id] yo'q) yoki tahrirlaydi. O'zini bloklay olmaydi va o'z rolini o'zgartira olmaydi —
   * tizimda admin qolmay qolmasin. Kassir va oshpaz yordamchisi filialga bog'lanadi. Kuryer — login (takrorlanmaydi)
   * va parol bilan, boshqalar — PIN bilan; kuryerlikka o'tganda yoki undan chiqqanda yangisi majburiy (eski PIN parol
   * bo'lib yoki parol PIN bo'lib qolmasin).
   */
  async save(input: SaveUserDto & { id?: string }, actorId: string, now = new Date()): Promise<User> {
    const name = input.name.trim();
    if (!name) fail('name_required');
    const needsBranch = roleNeedsBranch(input.role);
    if (needsBranch && !input.branchId) fail('branch_required');
    if (needsBranch && !(await this.branches.existsBy({ id: input.branchId ?? '' }))) {
      fail('not_found', `branch ${input.branchId}`);
    }
    const branchId = needsBranch ? (input.branchId ?? null) : null;
    const courier = input.role === 'courier';
    const login = courier ? normalizeLogin(input.login ?? '') : null;
    if (login !== null && !isValidLogin(login)) fail('invalid_login');
    const secret = courier ? (input.password ?? '') : (input.pin ?? '').trim();
    const secretValid = courier ? isValidPassword(secret) : isValidPin(secret);
    const secretError = courier ? 'invalid_password' : 'invalid_pin';

    if (input.id) {
      const current = (await this.users.findOneBy({ id: input.id })) ?? fail('not_found', `user ${input.id}`);
      if (current.id === actorId && (!input.active || input.role !== current.role)) fail('self_action');
      const kindChanged = (current.role === 'courier') !== courier;
      if ((secret || kindChanged) && !secretValid) fail(secretError);
      if (login && (await this.loginTaken(login, current.id))) fail('login_taken');
      const patch: Partial<User> = { name, role: input.role, branchId, login, active: input.active };
      if (secret) patch.pinHash = await hashPin(secret);
      await this.uniqueLogin(() => this.users.update(current.id, patch));
      // bloklandi yoki boshqa rol / filialga o'tdi — ochiq socket ulanishlari uziladi (qayta ulansa — yangi xonaga)
      if (!input.active || input.role !== current.role || branchId !== current.branchId) this.revocations.user(current.id);
      return (await this.users.findOneBy({ id: current.id }))!;
    }

    if (!secretValid) fail(secretError);
    if (login && (await this.loginTaken(login))) fail('login_taken');
    const id = newId('usr');
    const pinHash = await hashPin(secret);
    await this.uniqueLogin(() =>
      this.users.insert({ id, name, role: input.role, branchId, login, pinHash, active: input.active, createdAt: now }),
    );
    return (await this.users.findOneBy({ id }))!;
  }

  private loginTaken(login: string, exceptId?: string): Promise<boolean> {
    return this.users.existsBy({ login, ...(exceptId && { id: Not(exceptId) }) });
  }

  /** Bir vaqtda ikki admin bir xil login bersa — bazadagi unique indeks ushlaydi. */
  private async uniqueLogin<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof QueryFailedError && (error as QueryFailedError & { code?: string }).code === '23505') {
        fail('login_taken');
      }
      throw error;
    }
  }
}
