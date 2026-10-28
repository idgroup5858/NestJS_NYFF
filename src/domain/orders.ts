import type { OrderSource, OrderType } from '../common/enums';

/** Tayyor bo'lgan raqam TV va kassa ro'yxatida shuncha vaqt turadi, keyin o'zi tushadi. */
export const READY_SHOWN_MS = 5 * 60_000;

/** Mobil buyurtma shu vaqtda qabul qilinmasa — boshqa filialga o'tadi yoki bekor bo'ladi (ROADMAP 2-bo'lim). */
export const MOBILE_ACCEPT_MS = 5 * 60_000;

/** Mobil buyurtma bir martadan ko'p o'tkazilmaydi — filiallar orasida aylanib yurmasin. */
export const MAX_ORDER_TRANSFERS = 1;

/**
 * Kuryerlarning "Yangi" ro'yxatiga shu vaqt ichida yaratilgan dostavkalar chiqadi — kuryer tizimidan oldingi (tarixdagi)
 * `ready` buyurtmalar ro'yxatni to'ldirib yubormasin.
 */
export const COURIER_PICKUP_WINDOW_MS = 12 * 60 * 60_000;

/**
 * TV navbat ekraniga chiqadimi: faqat kassa va kioskdan — zalda yoki olib ketish. Dostavka va mobil ilovadagi buyurtmani
 * mijoz zalda kutmaydi (holatini ilovada ko'radi) — TV ga chiqmaydi; oshxona ekranida esa hammasi bor.
 */
export function showsOnTv(order: { source: OrderSource; type: OrderType }): boolean {
  return order.source !== 'mobile' && order.type !== 'delivery';
}
