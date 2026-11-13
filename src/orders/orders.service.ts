import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, MoreThanOrEqual } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { Branch } from '../branches/branch.entity';
import { BranchesService } from '../branches/branches.service';
import type { CancelReason, OrderSource, OrderType, PaymentMethod } from '../common/enums';
import { fail } from '../common/errors';
import { newId, newSecret, sha256 } from '../common/ids';
import { pageParams, type Page } from '../common/pagination';
import type { OnlineInfo, OrderItem, PaymentSplit } from '../common/types';
import { nextCounter } from '../database/counters';
import { dateKey } from '../domain/dates';
import { isLatLng, roundLatLng } from '../domain/geo';
import {
  COURIER_PICKUP_WINDOW_MS,
  MAX_ORDER_TRANSFERS,
  MOBILE_ACCEPT_MS,
  READY_SHOWN_MS,
  showsOnTv,
} from '../domain/orders';
import { resolvePayment } from '../domain/payments';
import { Product, soldAt } from '../menu/product.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Shift } from '../shifts/shift.entity';
import { PAID_STATUS_SQL, paymentPartSql } from '../shifts/shift-summary';
import { StockService } from '../warehouse/stock.service';
import { NO_COURIER, Order } from './order.entity';
import { ConfirmOrderDto, CreateOrderDto, KioskOrderDto, MobileOrderDto, OrdersQuery } from './order.dto';
import { customerOrderView, orderView, tvOrderView, type CustomerOrderView, type OrderView } from './order.views';

/** Buyurtma yaratish — manba (kassa / kiosk / mobil) controllerda aniqlanadi, bu yerga tayyor holda keladi. */
export interface PlaceOrderInput {
  /** kassa o'zi bergan id (`CreateOrderDto.id`); berilmasa — yangisi */
  id?: string;
  branchId: string;
  type: OrderType;
  source: OrderSource;
  items: { productId: string; qty: number }[];
  note?: string;
  /** `null` — kioskda (mijoz kassada to'laydi) va mobil ilovada (kassir qabul qilguncha): buyurtma kassirni kutadi */
  payment: PaymentMethod | null;
  split?: PaymentSplit | null;
  /** kiosk va mobil buyurtmada `null` */
  cashierId: string | null;
  /** faqat mobil ilovada */
  online?: OnlineInfo | null;
  /** mobil dostavka: hudud narxi (mijozga ko'rsatilgani); hududdan tashqarida — `null` */
  deliveryFee?: number | null;
}

/** Filialning kunlik buyurtma raqami hisoblagichi (`counters`). */
export const orderCounterKey = (branchId: string, now: Date) => `order:${branchId}:${dateKey(now)}`;

/** Admin ro'yxatining jami (filtrlangan hamma buyurtmalar bo'yicha, sahifadan qat'i nazar). */
export interface OrdersSummary {
  count: number;
  /** to'langan (tayyorlanmoqda / tayyor) — tushum */
  paid: { count: number; amount: number };
  cancelled: { count: number; amount: number };
  /** kassada to'lanmagan kiosk / qabul qilinmagan mobil */
  pending: { count: number; amount: number };
}

/**
 * Mobil buyurtma ma'lumotlari: telefon (kamida 9 raqam) majburiy; dostavkada manzil matni — faqat xaritadan joy
 * (`location`) berilmagan bo'lsa; zalda yeyish — yo'q.
 */
function cleanOnline(type: OrderType, online: OnlineInfo): OnlineInfo {
  if (type === 'dine_in') fail('invalid_status', 'mobile dine_in');
  const phone = online.phone.trim();
  if (phone.replace(/\D/g, '').length < 9) fail('phone_required');
  const address = type === 'delivery' ? (online.address ?? '').trim() : '';
  if (type === 'delivery' && !address && !online.location) fail('address_required');
  if (online.location && !isLatLng(online.location)) fail('invalid_location');
  const location = online.location ? roundLatLng(online.location) : null;
  return { platform: online.platform, name: online.name.trim(), phone, address, payment: online.payment, location };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stock: StockService,
    private readonly branches: BranchesService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ───────────────────────── Yaratish ─────────────────────────

  /**
   * Kassa: filial va kassir — tokendan; buyurtma kassirning ochiq smenasiga yoziladi. Kassa id bergan bo'lsa va shu
   * id'li buyurtma allaqachon bor (javob yo'lda yo'qolgan, kassa qayta yubordi) — yangisi yozilmaydi, o'sha qaytadi.
   */
  async createByCashier(user: AuthUser, dto: CreateOrderDto, now = new Date()): Promise<OrderView> {
    const existing = dto.id ? await this.dataSource.manager.findOneBy(Order, { id: dto.id }) : null;
    if (existing) return this.retriedOrder(existing, user);
    try {
      const order = await this.place(
        {
          id: dto.id,
          branchId: user.branchId ?? fail('branch_required'),
          type: dto.type,
          source: 'cashier',
          items: dto.items,
          note: dto.note,
          payment: dto.payment ?? null,
          split: dto.split,
          cashierId: user.id,
        },
        now,
      );
      return orderView(order);
    } catch (error) {
      // bir xil id bilan ikkita so'rov bir vaqtda keldi — ikkinchisi birinchisining natijasini oladi
      if (!dto.id || (error as { code?: string }).code !== '23505') throw error;
      const order = (await this.dataSource.manager.findOneBy(Order, { id: dto.id })) ?? fail('not_found', dto.id);
      return this.retriedOrder(order, user);
    }
  }

  /** Qayta yuborilgan kassa buyurtmasi — faqat o'sha kassirning o'sha filialdagi buyurtmasi bo'lsa qaytadi. */
  private retriedOrder(order: Order, user: AuthUser): OrderView {
    if (order.source !== 'cashier' || order.cashierId !== user.id || order.branchId !== user.branchId) {
      fail('invalid_input', `order id ${order.id} taken`);
    }
    return orderView(order);
  }

  /** Kiosk: filial — qurilmaniki; karta / Click bilan to'langan yoki "kassada to'layman" (`payment: null`). */
  async createByKiosk(dto: KioskOrderDto, now = new Date()): Promise<CustomerOrderView> {
    const order = await this.place(
      {
        branchId: dto.branchId,
        type: dto.type,
        source: 'kiosk',
        items: dto.items,
        note: dto.note,
        payment: dto.payment ?? null,
        cashierId: null,
      },
      now,
    );
    return customerOrderView(order);
  }

  /**
   * Mobil ilova. Dostavka — filialni server joylashuv bo'yicha tanlaydi (`routeDelivery`), ilova yuborgan filialga
   * ishonilmaydi; olib ketish — mijoz tanlagan filial ochiq bo'lishi shart. Javobda kuzatish tokeni (faqat bir marta).
   */
  async createByMobile(
    dto: MobileOrderDto,
    now = new Date(),
  ): Promise<{ order: CustomerOrderView; trackingToken: string }> {
    // mijoz o'zi tuzata oladigan xatolar (bo'sh savat, telefon, manzil) — filial tanlashdan oldin
    if (dto.items.length === 0) fail('empty_order');
    const online = cleanOnline(dto.type, {
      ...dto.online,
      address: dto.online.address ?? '',
      location: dto.online.location ?? null,
    });
    let branchId: string;
    let deliveryFee: number | null = null;
    if (dto.type === 'delivery') {
      const location = online.location ?? fail('location_required');
      const route = await this.branches.route(location, now);
      branchId = route.branchId ?? fail('branch_closed');
      deliveryFee = route.fee;
    } else {
      const branch = await this.branches.get(this.dataSource.manager, dto.branchId ?? fail('branch_required'));
      if (!(await this.branches.isOpen(branch, now))) fail('branch_closed', branch.id);
      branchId = branch.id;
    }
    const trackingToken = newSecret(24);
    const order = await this.place(
      {
        branchId,
        type: dto.type,
        source: 'mobile',
        items: dto.items,
        note: dto.note,
        payment: null,
        cashierId: null,
        online,
        deliveryFee,
      },
      now,
      sha256(trackingToken),
    );
    return { order: customerOrderView(order), trackingToken };
  }

  /**
   * Buyurtma: narxlar taomdan olinadi (filialda sotuvda bo'lishi shart), raqam filialning bugungi navbatidagi son. To'langan buyurtma darhol
   * "tayyorlanmoqda" (chek oshxonaga) va mahsulotlar ombordan ayriladi; kassir buyurtmasi uning ochiq smenasiga yoziladi.
   * Kioskda "kassada to'layman" va mobil ilovadan — `pending`: kassir tasdiqlaguncha oshxonaga ham, omborga ham tegmaydi.
   */
  async place(input: PlaceOrderInput, now = new Date(), trackingTokenHash: string | null = null): Promise<Order> {
    const order = await this.dataSource.transaction(async (em) => {
      if (input.items.length === 0) fail('empty_order');
      const branch = (await em.findOneBy(Branch, { id: input.branchId })) ?? fail('not_found', `branch ${input.branchId}`);
      if (!branch.active) fail('not_found', `branch ${branch.id} inactive`);
      if (input.payment === null && input.source === 'cashier') fail('invalid_amount');
      let online: OnlineInfo | null = null;
      if (input.source === 'mobile') {
        if (!input.online || input.payment !== null || input.cashierId !== null) fail('invalid_amount');
        online = cleanOnline(input.type, input.online);
      }

      const products = await this.productMap(em, [...new Set(input.items.map((line) => line.productId))]);
      const items: OrderItem[] = input.items.map((line) => {
        if (!Number.isInteger(line.qty) || line.qty < 1) fail('invalid_qty', line.productId);
        const product = products.get(line.productId) ?? fail('not_found', `product ${line.productId}`);
        if (!soldAt(product, branch.id)) fail('product_unavailable', product.id);
        if (product.dineInOnly && input.type !== 'dine_in') fail('dine_in_only', product.id);
        return { productId: product.id, name: product.name, price: product.price, qty: line.qty };
      });

      const shiftId = input.cashierId !== null ? await this.openShiftId(em, input.cashierId, branch.id) : null;
      const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      const paid = input.payment === null ? null : resolvePayment(input.payment, input.split, total);

      const order: Order = {
        id: input.id ?? newId('ord'),
        branchId: branch.id,
        number: await nextCounter(em, orderCounterKey(branch.id, now)),
        type: input.type,
        source: input.source,
        items,
        note: input.note?.trim() ?? '',
        total,
        payment: paid?.payment ?? null,
        split: paid?.split ?? null,
        online,
        status: paid ? 'preparing' : 'pending',
        cashierId: input.cashierId,
        shiftId,
        createdAt: now,
        preparingAt: paid ? now : null,
        readyAt: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        routedAt: now,
        transferCount: 0,
        fromBranchId: null,
        trackingTokenHash,
        ...NO_COURIER,
        deliveryFee: input.source === 'mobile' && input.type === 'delivery' ? (input.deliveryFee ?? null) : null,
        syncedAt: null,
      };
      await em.insert(Order, order);
      if (paid) await this.deductStock(em, order, products, now);
      return order;
    });
    this.realtime.orderChanged(order);
    return order;
  }

  // ───────────────────────── Holatlar ─────────────────────────

  /**
   * Kassir kiosk buyurtmasining pulini oldi yoki mobil buyurtmani qabul qildi (to'lov — mijoz tanlagani): pending →
   * preparing, uning smenasiga yoziladi, mahsulotlar ombordan ayriladi.
   */
  async confirm(orderId: string, user: AuthUser, dto: ConfirmOrderDto, now = new Date()): Promise<OrderView> {
    const order = await this.dataSource.transaction(async (em) => {
      const order = await this.lock(em, orderId);
      if (order.branchId !== user.branchId) fail('forbidden', 'other branch');
      if (order.status !== 'pending') fail('invalid_status', `${order.status} → preparing`);
      const shiftId = await this.openShiftId(em, user.id, order.branchId);
      const paid = order.online
        ? resolvePayment(order.online.payment, null, order.total)
        : resolvePayment(dto.payment ?? fail('invalid_amount'), dto.split, order.total);
      const patch = {
        payment: paid.payment,
        split: paid.split,
        status: 'preparing' as const,
        cashierId: user.id,
        shiftId,
        preparingAt: now,
      };
      await em.update(Order, order.id, patch);
      Object.assign(order, patch);
      await this.deductStock(em, order, await this.productMap(em, order.items.map((i) => i.productId)), now);
      return order;
    });
    this.realtime.orderChanged(order);
    return orderView(order);
  }

  /**
   * Oshpaz yordamchisi ovqatni oshxonadan olib chiqib "Tayyor" bosadi: preparing → ready (TV da «Tayyor» ustuni).
   * Filialda `cashierMarksReady` yoqilgan bo'lsa — kassir ham.
   */
  markReady(orderId: string, user: AuthUser, now = new Date()): Promise<OrderView> {
    return this.change(orderId, async (em, order) => {
      await this.assertCanMarkReady(em, user, order);
      if (order.status !== 'preparing') fail('invalid_status', `${order.status} → ready`);
      return { status: 'ready', readyAt: now };
    });
  }

  /**
   * Adashib "tayyor" deyilganini qaytaradi: ready → preparing. "Tayyor"ni kim bosa olsa, shu (oshpaz yordamchisi; filialda
   * yoqilgan bo'lsa — kassir ham); kuryer yo'lga chiqqan bo'lsa — yo'q.
   */
  reopen(orderId: string, user: AuthUser, now = new Date()): Promise<OrderView> {
    return this.change(orderId, async (em, order) => {
      await this.assertCanMarkReady(em, user, order);
      if (order.status !== 'ready') fail('invalid_status', `${order.status} → preparing`);
      if (order.departedAt) fail('invalid_status', 'courier departed');
      return { status: 'preparing', readyAt: null, preparingAt: order.preparingAt ?? now };
    });
  }

  /**
   * Bekor qilish — filial kassiri yoki admin. Sotuvda ayrilgan mahsulotlar aynan o'sha miqdorda omborga qaytadi
   * (to'lanmagan kiosk / qabul qilinmagan mobil buyurtmada — hech narsa).
   */
  cancel(orderId: string, user: AuthUser, now = new Date()): Promise<OrderView> {
    return this.change(orderId, async (em, order) => {
      const allowed = user.role === 'admin' || (user.role === 'cashier' && user.branchId === order.branchId);
      if (!allowed) fail('forbidden', `${user.role} ${user.id}`);
      if (order.status === 'cancelled') fail('invalid_status', order.status);
      if (order.deliveredAt) fail('invalid_status', 'delivered');
      await this.returnStock(em, order, now);
      return { status: 'cancelled', cancelledAt: now, cancelledBy: user.id, cancelReason: null };
    });
  }

  /**
   * Buyurtmani kuryerdan olish (kassir — o'z filiali, admin): "Yetkazib bo'lmadi" bilan qaytgan, kuryer olib qolib
   * ketgan yoki boshqa kuryerga berish kerak bo'lgan dostavka yana "Yangi" ro'yxatiga tushadi. Yetkazilgani — yo'q.
   */
  releaseCourier(orderId: string, user: AuthUser): Promise<OrderView> {
    return this.change(orderId, async (_em, order) => {
      const allowed = user.role === 'admin' || (user.role === 'cashier' && user.branchId === order.branchId);
      if (!allowed) fail('forbidden', `${user.role} ${user.id}`);
      if (!order.courierId || order.deliveredAt || order.status === 'cancelled') {
        fail('invalid_status', order.deliveredAt ? 'delivered' : order.status);
      }
      const { deliveryFee: _fee, ...cleared } = NO_COURIER;
      return cleared;
    });
  }

  // ───────────────────────── Mobil buyurtma: qabul muddati ─────────────────────────

  /**
   * Qabul qilinmagan mobil buyurtmalar (fon ishi, har 30 soniyada). 5 daqiqada qabul qilinmasa yoki shu orada filial
   * yopilsa: dostavka — boshqa ochiq filialga (bir marta, yangi raqam bilan), olib ketish — bekor (mijoz filialni o'zi
   * tanlagan), o'tkazadigan ochiq filial yo'q — bekor. Bir nechta server bo'lsa ham bir buyurtmani bittasi ko'radi.
   */
  async expirePendingMobile(now = new Date()): Promise<number> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM orders WHERE source = 'mobile' AND status = 'pending' ORDER BY "routedAt"`,
    );
    let changed = 0;
    for (const { id } of rows) {
      try {
        if (await this.reviewPendingMobile(id, now)) changed++;
      } catch (error) {
        this.logger.error(`Mobil buyurtma ${id}: ${(error as Error).message}`);
      }
    }
    return changed;
  }

  private async reviewPendingMobile(id: string, now: Date): Promise<boolean> {
    const result = await this.dataSource.transaction(async (em) => {
      const order = await em
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('o.id = :id', { id })
        .getOne();
      if (!order || order.status !== 'pending' || order.source !== 'mobile') return null;

      const overdue = now.getTime() - order.routedAt.getTime() >= MOBILE_ACCEPT_MS;
      const branch = await em.findOneBy(Branch, { id: order.branchId });
      const open = branch ? await this.branches.isOpen(branch, now, em) : false;
      if (!overdue && open) return null;

      let reason: CancelReason = overdue ? 'timeout' : 'branch_closed';
      const location = order.online?.location;
      if (order.type === 'delivery' && order.transferCount < MAX_ORDER_TRANSFERS && location) {
        const route = await this.branches.route(location, now, order.branchId, em);
        // yangi filial hamma taomni sotishi shart; narx va summa o'zgarmaydi (mijoz shu summaga rozi bo'lgan)
        if (route.branchId && (await this.sellsAll(em, route.branchId, order.items))) {
          const previousBranchId = order.branchId;
          const patch = {
            branchId: route.branchId,
            number: await nextCounter(em, orderCounterKey(route.branchId, now)),
            fromBranchId: previousBranchId,
            routedAt: now,
            transferCount: order.transferCount + 1,
          };
          await em.update(Order, order.id, patch);
          return { order: Object.assign(order, patch), previousBranchId };
        }
        reason = 'no_branch';
      }
      const patch = { status: 'cancelled' as const, cancelledAt: now, cancelledBy: null, cancelReason: reason };
      await em.update(Order, order.id, patch);
      return { order: Object.assign(order, patch), previousBranchId: null };
    });
    if (!result) return false;
    this.realtime.orderChanged(result.order, result.previousBranchId);
    return true;
  }

  // ───────────────────────── O'qish ─────────────────────────

  /** Ishdagi buyurtmalar (kassada to'lanmagan kiosk / qabul kutayotgan mobil + tayyorlanayotgan), eskisi birinchi. */
  async active(branchId: string): Promise<OrderView[]> {
    const orders = await this.dataSource.manager.find(Order, {
      where: { branchId, status: In(['pending', 'preparing']) },
      order: { createdAt: 'ASC' },
    });
    return orders.map(orderView);
  }

  /** Yaqinda (5 daqiqada) tayyor bo'lganlar, yangisi birinchi. */
  async recentReady(branchId: string, now = new Date()): Promise<OrderView[]> {
    return (await this.readySince(branchId, now)).map(orderView);
  }

  /**
   * Kuryer ishidagi dostavkalar (kassaning "Dostavka" ro'yxati): qabul qilingan, hali yetkazilmagan mobil dostavkalar —
   * kuryer kutayotgan, olingan, yo'ldagi va "Yetkazib bo'lmadi" bilan qaytganlar; oxirgi 12 soatdagi, eskisi birinchi.
   */
  async deliveries(branchId: string, now = new Date()): Promise<OrderView[]> {
    const orders = await this.dataSource.manager.find(Order, {
      where: {
        branchId,
        source: 'mobile',
        type: 'delivery',
        status: In(['preparing', 'ready']),
        deliveredAt: IsNull(),
        createdAt: MoreThanOrEqual(new Date(now.getTime() - COURIER_PICKUP_WINDOW_MS)),
      },
      order: { createdAt: 'ASC' },
    });
    return orders.map(orderView);
  }

  /** TV navbat ekrani: faqat `showsOnTv` buyurtmalar, faqat raqam / tur / holat. */
  async tvQueue(branchId: string, now = new Date()) {
    const branch = await this.dataSource.manager.findOneBy(Branch, { id: branchId });
    if (!branch?.active) fail('not_found', `branch ${branchId}`);
    const preparing = await this.dataSource.manager.find(Order, { where: { branchId, status: 'preparing' } });
    preparing.sort((a, b) => (a.preparingAt ?? a.createdAt).getTime() - (b.preparingAt ?? b.createdAt).getTime());
    const ready = await this.readySince(branchId, now);
    return {
      preparing: preparing.filter(showsOnTv).map(tvOrderView),
      ready: ready.filter(showsOnTv).map(tvOrderView),
    };
  }

  private readySince(branchId: string, now: Date): Promise<Order[]> {
    return this.dataSource.manager
      .createQueryBuilder(Order, 'o')
      .where('o.branchId = :branchId', { branchId })
      .andWhere(`o.status = 'ready'`)
      .andWhere('o.readyAt > :since', { since: new Date(now.getTime() - READY_SHOWN_MS) })
      .orderBy('o.readyAt', 'DESC')
      .getMany();
  }

  /**
   * Admin ro'yxati (yangisi birinchi, sahifalangan) va filtrlangan **hamma** buyurtmalar jami: soni, tushum
   * (to'langanlar), bekor qilinganlar, kassada to'lanmaganlar / qabul qilinmaganlar.
   */
  async findAll(query: OrdersQuery): Promise<Page<OrderView> & { summary: OrdersSummary }> {
    const { page, limit, skip } = pageParams(query);
    const qb = this.dataSource.manager.createQueryBuilder(Order, 'o');
    if (query.branchId) qb.andWhere('o.branchId = :branchId', { branchId: query.branchId });
    if (query.status) qb.andWhere('o.status = :status', { status: query.status });
    if (query.source) qb.andWhere('o.source = :source', { source: query.source });
    if (query.type) qb.andWhere('o.type = :type', { type: query.type });
    if (query.shiftId) qb.andWhere('o.shiftId = :shiftId', { shiftId: query.shiftId });
    if (query.cashierId) qb.andWhere('o.cashierId = :cashierId', { cashierId: query.cashierId });
    if (query.courierId) qb.andWhere('o.courierId = :courierId', { courierId: query.courierId });
    if (query.number !== undefined) qb.andWhere('o.number = :number', { number: query.number });
    // aralash to'lov ikkala turda ham chiqadi
    if (query.payment) qb.andWhere(`(${paymentPartSql(query.payment)}) > 0`);
    if (query.from) qb.andWhere('o.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('o.createdAt < :to', { to: query.to });

    const totals = await qb
      .clone()
      .select('COUNT(*)', 'count')
      .addSelect(`COUNT(*) FILTER (WHERE ${PAID_STATUS_SQL})`, 'paidCount')
      .addSelect(`COALESCE(SUM(o.total) FILTER (WHERE ${PAID_STATUS_SQL}), 0)`, 'paidAmount')
      .addSelect(`COUNT(*) FILTER (WHERE o.status = 'cancelled')`, 'cancelledCount')
      .addSelect(`COALESCE(SUM(o.total) FILTER (WHERE o.status = 'cancelled'), 0)`, 'cancelledAmount')
      .addSelect(`COUNT(*) FILTER (WHERE o.status = 'pending')`, 'pendingCount')
      .addSelect(`COALESCE(SUM(o.total) FILTER (WHERE o.status = 'pending'), 0)`, 'pendingAmount')
      .getRawOne<Record<string, string>>();
    const orders = await qb.orderBy('o.createdAt', 'DESC').skip(skip).take(limit).getMany();
    const n = (key: string) => Number(totals?.[key] ?? 0);
    return {
      items: orders.map(orderView),
      total: n('count'),
      page,
      limit,
      summary: {
        count: n('count'),
        paid: { count: n('paidCount'), amount: n('paidAmount') },
        cancelled: { count: n('cancelledCount'), amount: n('cancelledAmount') },
        pending: { count: n('pendingCount'), amount: n('pendingAmount') },
      },
    };
  }

  /** Admin — istalgan; filial xodimi — faqat o'z filialiniki. */
  async findOne(id: string, user: AuthUser): Promise<OrderView> {
    const order = (await this.dataSource.manager.findOneBy(Order, { id })) ?? fail('not_found', `order ${id}`);
    if (user.role !== 'admin' && order.branchId !== user.branchId) fail('forbidden', 'other branch');
    return orderView(order);
  }

  /** Mobil ilova o'z buyurtmasini kuzatish tokeni bilan ko'radi (id'ni bilish yetarli emas). */
  async track(id: string, token: string | undefined): Promise<CustomerOrderView> {
    const order = await this.dataSource.manager
      .createQueryBuilder(Order, 'o')
      .addSelect('o.trackingTokenHash')
      .where('o.id = :id', { id })
      .getOne();
    if (!order?.trackingTokenHash || !token || order.trackingTokenHash !== sha256(token)) {
      fail('not_found', `order ${id}`);
    }
    return customerOrderView(order);
  }

  // ───────────────────────── Yordamchilar ─────────────────────────

  /** Buyurtmani qulflab o'zgartiradi; xabar tranzaksiya tugagandan keyin yuboriladi. */
  private async change(
    orderId: string,
    mutate: (em: EntityManager, order: Order) => Promise<Partial<Order>>,
  ): Promise<OrderView> {
    const order = await this.dataSource.transaction(async (em) => {
      const order = await this.lock(em, orderId);
      const patch = await mutate(em, order);
      await em.update(Order, order.id, patch);
      return Object.assign(order, patch);
    });
    this.realtime.orderChanged(order);
    return orderView(order);
  }

  /**
   * "Tayyor" va "Qaytarish" — buyurtma filialining oshpaz yordamchisi. Kassir (o'sha filialniki) — faqat filialda
   * `cashierMarksReady` yoqilgan bo'lsa (oshpaz yordamchisi yo'q filial); aks holda kassir holatni faqat kuzatadi.
   */
  private async assertCanMarkReady(em: EntityManager, user: AuthUser, order: Order): Promise<void> {
    const denied = () => fail('forbidden', `${user.role} ${user.id}`);
    if (user.branchId !== order.branchId) denied();
    if (user.role === 'kitchen') return;
    if (user.role !== 'cashier') denied();
    const branch = await em.findOne(Branch, { where: { id: order.branchId }, select: { id: true, cashierMarksReady: true } });
    if (!branch?.cashierMarksReady) denied();
  }

  private async lock(em: EntityManager, id: string): Promise<Order> {
    return (
      (await em.findOne(Order, { where: { id }, lock: { mode: 'pessimistic_write' } })) ?? fail('not_found', `order ${id}`)
    );
  }

  /** Kassirning shu filialdagi ochiq smenasi — bo'lmasa xato. */
  private async openShiftId(em: EntityManager, cashierId: string, branchId: string): Promise<string> {
    const shift = await em.findOneBy(Shift, { cashierId, branchId, closedAt: IsNull() });
    return shift?.id ?? fail('shift_not_open');
  }

  /** Filialda buyurtmadagi hamma taom sotuvdami (faol va filialda "vaqtincha sotilmaydi" emas). */
  private async sellsAll(em: EntityManager, branchId: string, items: OrderItem[]): Promise<boolean> {
    const ids = [...new Set(items.map((item) => item.productId))];
    const products = await this.productMap(em, ids);
    return ids.every((id) => {
      const product = products.get(id);
      return product !== undefined && soldAt(product, branchId);
    });
  }

  private async productMap(em: EntityManager, ids: string[]): Promise<Map<string, Product>> {
    const products = await em.findBy(Product, { id: In([...new Set(ids)]) });
    return new Map(products.map((p) => [p.id, p]));
  }

  /** To'langan buyurtma oshxonaga ketadi: retsept bo'yicha mahsulotlar filial omboridan ayriladi. */
  private async deductStock(em: EntityManager, order: Order, products: Map<string, Product>, at: Date) {
    await this.stock.deductOrder(em, order, at, products);
  }

  /** Sotuvda ayrilganlar (harakatlar bo'yicha) aynan qaytadi — retsept keyin o'zgargan bo'lsa ham. */
  private async returnStock(em: EntityManager, order: Order, at: Date) {
    await this.stock.returnOrder(em, order.id, at);
  }
}
