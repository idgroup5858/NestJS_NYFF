import type { Order } from './order.entity';

/**
 * Buyurtmaning tashqariga chiqadigan ko'rinishlari. Xodim — hammasi (tokendan tashqari); TV — faqat raqam, tur va
 * holat (PINsiz ekranga mijoz ma'lumoti chiqmaydi); mijoz — o'z buyurtmasi, xodimlar ma'lumotisiz.
 */

export type OrderView = Omit<Order, 'trackingTokenHash' | 'branch'>;

export function orderView(order: Order): OrderView {
  const { trackingTokenHash: _token, branch: _branch, ...view } = order;
  return view;
}

export interface TvOrderView {
  id: string;
  branchId: string;
  number: number;
  type: Order['type'];
  status: Order['status'];
  preparingAt: Date | null;
  readyAt: Date | null;
}

export function tvOrderView(order: Order): TvOrderView {
  return {
    id: order.id,
    branchId: order.branchId,
    number: order.number,
    type: order.type,
    status: order.status,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
  };
}

export type CustomerOrderView = Pick<
  Order,
  | 'id'
  | 'branchId'
  | 'number'
  | 'type'
  | 'items'
  | 'note'
  | 'total'
  | 'payment'
  | 'online'
  | 'status'
  | 'createdAt'
  | 'preparingAt'
  | 'readyAt'
  | 'cancelledAt'
  | 'cancelReason'
  | 'routedAt'
  | 'transferCount'
  | 'fromBranchId'
  | 'deliveryFee'
  | 'departedAt'
  | 'deliveredAt'
  | 'returnedAt'
>;

export function customerOrderView(order: Order): CustomerOrderView {
  return {
    id: order.id,
    branchId: order.branchId,
    number: order.number,
    type: order.type,
    items: order.items,
    note: order.note,
    total: order.total,
    payment: order.payment,
    online: order.online,
    status: order.status,
    createdAt: order.createdAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    // shu filialga tushgan vaqti — ilova "qabul kutilmoqda" vaqtini (5 daqiqa) shundan ko'rsatadi
    routedAt: order.routedAt,
    transferCount: order.transferCount,
    fromBranchId: order.fromBranchId,
    deliveryFee: order.deliveryFee,
    // kuryer: mijozga faqat holati ("Kuryer yo'lda", "Yetkazildi"), kuryer kimligi va navbati — yo'q
    departedAt: order.departedAt,
    deliveredAt: order.deliveredAt,
    returnedAt: order.returnedAt,
  };
}

/** Kuryer — o'zi olgan buyurtma: mijoz, telefon, manzil, taomlar, olinadigan pul, yo'ldagi navbati. */
export type CourierOrderView = Pick<
  Order,
  | 'id'
  | 'branchId'
  | 'number'
  | 'items'
  | 'note'
  | 'total'
  | 'online'
  | 'status'
  | 'createdAt'
  | 'preparingAt'
  | 'readyAt'
  | 'cancelledAt'
  | 'deliveryFee'
  | 'courierId'
  | 'takenAt'
  | 'departedAt'
  | 'deliveredAt'
  | 'returnedAt'
  | 'returnReason'
  | 'returnNote'
  | 'courierSeq'
  | 'courierLegKm'
>;

export function courierOrderView(order: Order): CourierOrderView {
  return {
    id: order.id,
    branchId: order.branchId,
    number: order.number,
    items: order.items,
    note: order.note,
    total: order.total,
    online: order.online,
    status: order.status,
    createdAt: order.createdAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    cancelledAt: order.cancelledAt,
    deliveryFee: order.deliveryFee,
    courierId: order.courierId,
    takenAt: order.takenAt,
    departedAt: order.departedAt,
    deliveredAt: order.deliveredAt,
    returnedAt: order.returnedAt,
    returnReason: order.returnReason,
    returnNote: order.returnNote,
    courierSeq: order.courierSeq,
    courierLegKm: order.courierLegKm,
  };
}

/** Kuryerlar xonasiga — faqat "o'zgardi" belgisi (ro'yxatni ilova REST'dan qayta oladi), mijoz ma'lumotisiz. */
export interface CourierSignal {
  id: string;
  branchId: string;
  number: number;
  status: Order['status'];
  courierId: string | null;
}

export function courierSignal(order: Order): CourierSignal {
  return {
    id: order.id,
    branchId: order.branchId,
    number: order.number,
    status: order.status,
    courierId: order.courierId,
  };
}
