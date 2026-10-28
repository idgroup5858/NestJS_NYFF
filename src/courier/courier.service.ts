import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, MoreThanOrEqual } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { Branch } from '../branches/branch.entity';
import type { OnlinePayment } from '../common/enums';
import { fail } from '../common/errors';
import type { LatLng, OrderItem } from '../common/types';
import { insertionKm, planRoute } from '../domain/courier-route';
import { dateKey, parseDateKey } from '../domain/dates';
import { distanceKm } from '../domain/geo';
import { COURIER_PICKUP_WINDOW_MS } from '../domain/orders';
import { Order } from '../orders/order.entity';
import { courierOrderView, type CourierOrderView } from '../orders/order.views';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { User } from '../users/user.entity';
import type { ReturnOrderDto } from './courier.dto';

/** Nega olib bo'lmaydi: "Ishdaman" o'chiq / qo'lda yo'ldagi buyurtmalar bor / qo'lda boshqa filial buyurtmalari bor. */
export type CourierBlock = 'off_duty' | 'courier_busy' | 'other_branch';

/** Kuryerlarning "Yangi" ro'yxati — mijoz ismi va telefonisiz (buyurtmani olgandan keyin ko'rinadi). */
export interface AvailableOrderView {
  id: string;
  branchId: string;
  number: number;
  status: Order['status'];
  createdAt: Date;
  preparingAt: Date | null;
  readyAt: Date | null;
  items: OrderItem[];
  total: number;
  /** mijoz tanlagan to'lov: `cash` — kuryer kassaga o'zidan to'laydi, mijozdan oladi; `click` — to'langan */
  payment: OnlinePayment | null;
  deliveryFee: number | null;
  address: string;
  location: LatLng | null;
  /** filialdan mijozgacha, km (to'g'ri chiziq bo'yicha) */
  distanceKm: number | null;
  /** qo'ldagi buyurtmalar yo'liga qo'shilsa yo'l qancha uzayadi, km; qo'lda buyurtma yo'q — `null` */
  extraKm: number | null;
  blocked: CourierBlock | null;
}

/** Kuryerning buyurtmalari: qo'ldagilar (yo'lga chiqqan bo'lsa — yetkazish tartibida) va bugun tugatganlari. */
export interface CourierOrders {
  active: CourierOrderView[];
  done: CourierOrderView[];
}

export interface CourierState {
  user: AuthUser;
  onDuty: boolean;
  /** qo'ldagi buyurtmalar filiali (bir vaqtda bittasi); bo'sh qo'l — `null` */
  branchId: string | null;
  departed: boolean;
}

const round2 = (km: number) => Math.round(km * 100) / 100;

/**
 * Kuryer (mobil ilova): "Ishdaman", istalgan filialdan dostavka olish (bir vaqtda bitta filialdan, soni cheklanmagan),
 * "Yo'lga chiqdim" — server yetkazish tartibini taklif qiladi (`planRoute`: mijozlar o'rtacha eng kam kutadi),
 * "Yetkazildi" / "Yetkazib bo'lmadi" — qolganlari shu nuqtadan qayta tartiblanadi. Buyurtma `status` i o'zgarmaydi.
 * Bir kuryerning amallari uning qatorini qulflab ketma-ket bajariladi (bir vaqtda ikki filialdan olib qo'ymasin).
 */
@Injectable()
export class CourierService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
  ) {}

  async me(user: AuthUser): Promise<CourierState> {
    const em = this.dataSource.manager;
    const courier = await em.findOneByOrFail(User, { id: user.id });
    const active = await this.activeOf(em, user.id);
    return {
      user,
      onDuty: courier.onDuty,
      branchId: active[0]?.branchId ?? null,
      departed: active.some((o) => o.departedAt !== null),
    };
  }

  async setDuty(user: AuthUser, onDuty: boolean): Promise<CourierState> {
    await this.dataSource.manager.update(User, user.id, { onDuty });
    return this.me(user);
  }

  /** Hali hech kim olmagan mobil dostavkalar (tayyorlanmoqda / tayyor), eskisi birinchi. */
  async available(user: AuthUser, now = new Date()): Promise<AvailableOrderView[]> {
    const em = this.dataSource.manager;
    const orders = await em.find(Order, {
      where: {
        source: 'mobile',
        type: 'delivery',
        status: In(['preparing', 'ready']),
        courierId: IsNull(),
        createdAt: MoreThanOrEqual(new Date(now.getTime() - COURIER_PICKUP_WINDOW_MS)),
      },
      order: { createdAt: 'ASC' },
    });
    if (orders.length === 0) return [];

    const courier = await em.findOneByOrFail(User, { id: user.id });
    const mine = await this.activeOf(em, user.id);
    const branches = new Map((await em.find(Branch)).map((b) => [b.id, b]));
    const myBranchId = mine[0]?.branchId ?? null;
    const departed = mine.some((o) => o.departedAt !== null);
    // qo'ldagilar — yo'lga chiqqanda taklif qilinadigan tartibda
    const myStart = myBranchId ? (branches.get(myBranchId)?.location ?? null) : null;
    const myPoints = new Map(mine.map((o) => [o.id, o.online?.location ?? null]));
    const myRoute = planRoute(myStart, stopsOf(mine)).map((stop) => myPoints.get(stop.id)!);

    return orders.map((order) => {
      const point = order.online?.location ?? null;
      const branchPoint = branches.get(order.branchId)?.location ?? null;
      const blocked: CourierBlock | null = !courier.onDuty
        ? 'off_duty'
        : departed
          ? 'courier_busy'
          : myBranchId && myBranchId !== order.branchId
            ? 'other_branch'
            : null;
      const sameBatch = mine.length > 0 && myBranchId === order.branchId;
      return {
        id: order.id,
        branchId: order.branchId,
        number: order.number,
        status: order.status,
        createdAt: order.createdAt,
        preparingAt: order.preparingAt,
        readyAt: order.readyAt,
        items: order.items,
        total: order.total,
        payment: order.online?.payment ?? null,
        deliveryFee: order.deliveryFee,
        address: order.online?.address ?? '',
        location: point,
        distanceKm: point && branchPoint ? round2(distanceKm(branchPoint, point)) : null,
        extraKm: point && sameBatch ? round2(insertionKm(myStart, myRoute, point)) : null,
        blocked,
      };
    });
  }

  /** Qo'ldagilar va bugun (mahalliy kun) yetkazilgan / qaytarilganlar. */
  async orders(user: AuthUser, now = new Date()): Promise<CourierOrders> {
    const em = this.dataSource.manager;
    const active = await this.activeOf(em, user.id);
    const dayStart = parseDateKey(dateKey(now));
    const done = await em
      .createQueryBuilder(Order, 'o')
      .where('o.courierId = :id', { id: user.id })
      .andWhere('(o.deliveredAt >= :day OR o.returnedAt >= :day)', { day: dayStart })
      .orderBy('COALESCE(o.deliveredAt, o.returnedAt)', 'DESC')
      .getMany();
    return { active: active.map(courierOrderView), done: done.map(courierOrderView) };
  }

  /** "Olaman": "Ishdaman" yoqilgan, yo'lda emas va qo'lda boshqa filial buyurtmasi yo'q bo'lsa. Takroriy bosish — xato emas. */
  async take(user: AuthUser, orderId: string, now = new Date()): Promise<CourierOrders> {
    const changed = await this.dataSource.transaction(async (em) => {
      const courier = await this.lockCourier(em, user.id);
      if (!courier.onDuty) fail('off_duty');
      const order = await this.lockOrder(em, orderId);
      if (order.source !== 'mobile' || order.type !== 'delivery') fail('invalid_status', 'not a delivery');
      if (order.courierId === user.id) return null;
      if (order.courierId) fail('already_taken');
      if (order.status !== 'preparing' && order.status !== 'ready') fail('invalid_status', order.status);
      const mine = await this.activeOf(em, user.id);
      if (mine.some((o) => o.departedAt !== null)) fail('courier_busy');
      if (mine.some((o) => o.branchId !== order.branchId)) fail('other_branch', mine[0].branchId);
      const patch = { courierId: user.id, takenAt: now };
      await em.update(Order, order.id, patch);
      return Object.assign(order, patch);
    });
    if (changed) this.realtime.orderChanged(changed);
    return this.orders(user, now);
  }

  /** Yo'lga chiqmasdan buyurtmani qaytarib berish — yana "Yangi" ro'yxatiga. */
  async release(user: AuthUser, orderId: string, now = new Date()): Promise<CourierOrders> {
    const changed = await this.dataSource.transaction(async (em) => {
      await this.lockCourier(em, user.id);
      const order = await this.lockOrder(em, orderId);
      if (order.courierId !== user.id) fail('forbidden', 'not yours');
      if (order.departedAt) fail('invalid_status', 'departed');
      const patch = { courierId: null, takenAt: null };
      await em.update(Order, order.id, patch);
      return Object.assign(order, patch);
    });
    this.realtime.orderChanged(changed);
    return this.orders(user, now);
  }

  /**
   * "Yo'lga chiqdim": qo'ldagi hamma buyurtma tayyor bo'lishi shart (kuryer ularni filialdan olgan); server filialdan
   * boshlab yetkazish tartibini beradi. Mijozga — "Kuryer yo'lda".
   */
  async depart(user: AuthUser, now = new Date()): Promise<CourierOrders> {
    const changed = await this.dataSource.transaction(async (em) => {
      await this.lockCourier(em, user.id);
      const waiting = (await this.activeOf(em, user.id)).filter((o) => o.departedAt === null);
      if (waiting.length === 0) fail('empty_order');
      const notReady = waiting.filter((o) => o.status !== 'ready');
      if (notReady.length > 0) fail('not_ready', notReady.map((o) => o.number).join(','));
      const branch = await em.findOneBy(Branch, { id: waiting[0].branchId });
      return this.sequence(em, branch?.location ?? null, waiting, 1, { departedAt: now });
    });
    for (const order of changed) this.realtime.orderChanged(order);
    return this.orders(user, now);
  }

  deliver(user: AuthUser, orderId: string, now = new Date()): Promise<CourierOrders> {
    return this.finish(user, orderId, { deliveredAt: now }, now);
  }

  /** "Yetkazib bo'lmadi": buyurtma filialga qaytadi; keyingisini kassir / admin hal qiladi (bekor yoki qayta yuborish). */
  returnOrder(user: AuthUser, orderId: string, dto: ReturnOrderDto, now = new Date()): Promise<CourierOrders> {
    return this.finish(user, orderId, { returnedAt: now, returnReason: dto.reason, returnNote: dto.note?.trim() ?? '' }, now);
  }

  // ───────────────────────── Yordamchilar ─────────────────────────

  /** Yetkazildi / qaytarildi; yo'lda qolganlar shu manzildan boshlab qayta tartiblanadi. */
  private async finish(user: AuthUser, orderId: string, patch: Partial<Order>, now: Date): Promise<CourierOrders> {
    const changed = await this.dataSource.transaction(async (em) => {
      await this.lockCourier(em, user.id);
      const order = await this.lockOrder(em, orderId);
      if (order.courierId !== user.id) fail('forbidden', 'not yours');
      if (order.status === 'cancelled' || order.deliveredAt || order.returnedAt) fail('invalid_status', 'finished');
      if (!order.departedAt) fail('invalid_status', 'not departed');
      await em.update(Order, order.id, patch);
      Object.assign(order, patch);
      const rest = (await this.activeOf(em, user.id)).filter((o) => o.departedAt !== null);
      const start = order.online?.location ?? null;
      return [order, ...(await this.sequence(em, start, rest, (order.courierSeq ?? 0) + 1, {}))];
    });
    for (const order of changed) this.realtime.orderChanged(order);
    return this.orders(user, now);
  }

  /** Tartib (`planRoute`) → `courierSeq` [firstSeq] dan, `courierLegKm`. Joylashuvsiz buyurtmalar — oxirida. */
  private async sequence(
    em: EntityManager,
    start: LatLng | null,
    orders: Order[],
    firstSeq: number,
    extra: Partial<Order>,
  ): Promise<Order[]> {
    const plan = planRoute(start, stopsOf(orders));
    const planned = new Map(plan.map((stop, index) => [stop.id, { index, legKm: round2(stop.legKm) }]));
    const unplaced = orders.filter((o) => !planned.has(o.id));
    const ordered = [
      ...plan.map((stop) => orders.find((o) => o.id === stop.id)!),
      ...unplaced,
    ];
    for (const [index, order] of ordered.entries()) {
      const patch = { ...extra, courierSeq: firstSeq + index, courierLegKm: planned.get(order.id)?.legKm ?? null };
      await em.update(Order, order.id, patch);
      Object.assign(order, patch);
    }
    return ordered;
  }

  /** Qo'ldagilar: yetkazilmagan, qaytarilmagan, bekor qilinmagan. Yo'lda — navbat bo'yicha, aks holda olingan vaqti bo'yicha. */
  private async activeOf(em: EntityManager, courierId: string): Promise<Order[]> {
    const orders = await em.find(Order, {
      where: { courierId, deliveredAt: IsNull(), returnedAt: IsNull(), status: In(['preparing', 'ready']) },
    });
    const key = (o: Order) => o.courierSeq ?? Number.MAX_SAFE_INTEGER;
    return orders.sort((a, b) => key(a) - key(b) || (a.takenAt?.getTime() ?? 0) - (b.takenAt?.getTime() ?? 0));
  }

  private async lockCourier(em: EntityManager, id: string): Promise<User> {
    return (await em.findOne(User, { where: { id }, lock: { mode: 'pessimistic_write' } })) ?? fail('not_found', `user ${id}`);
  }

  private async lockOrder(em: EntityManager, id: string): Promise<Order> {
    return (await em.findOne(Order, { where: { id }, lock: { mode: 'pessimistic_write' } })) ?? fail('not_found', `order ${id}`);
  }
}

function stopsOf(orders: Order[]) {
  return orders.flatMap((o) => (o.online?.location ? [{ id: o.id, point: o.online.location }] : []));
}
