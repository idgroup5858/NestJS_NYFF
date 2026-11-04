import type { OrderType, PaymentMethod } from '../common/enums';
import type { LocalizedText, OrderItem, PaymentSplit } from '../common/types';
import type { MenuProduct } from '../menu/menu.service';

/**
 * Markaz (`/api/sync/*`) va filialning offline kassasi (`C:\BACKEND APPS\ElectronJS_NYFF` — kassa kompyuterida) orasidagi
 * ma'lumotlar. Offline kassa internet bor paytda markazdan nusxa oladi, internet yo'q paytda kassa unga yozadi,
 * internet qaytgach buyurtmalarni shu yerga yuboradi. Electron loyihasida shu turlarning nusxasi bor — o'zgarsa ikkalasi.
 */

/** Offline kassaga kira oladigan kassir: PIN offline'da shu bcrypt xesh bilan tekshiriladi (PIN'ning o'zi emas). */
export interface SyncCashier {
  id: string;
  name: string;
  surname: string;
  pinHash: string;
}

export interface SyncCategory {
  id: string;
  name: LocalizedText;
  image: string;
  icon: string;
  sortOrder: number;
  active: boolean;
}

/** Kassa menyusi (`GET /menu?all=true` bilan bir xil): sotilmaydigan taom — `price: null`. */
export interface SyncMenu {
  branchId: string;
  categories: SyncCategory[];
  products: MenuProduct[];
}

/** Menyudagi rasm fayli (`/images/products/cola.png`) — offline server faqat o'zgarganini qayta yuklaydi. */
export interface SyncImage {
  path: string;
  size: number;
  modifiedAt: string;
}

/** Filialning bugungi buyurtma raqami (`date` — mahalliy sana `YYYY-MM-DD`) — nusxa olingan paytdagisi. */
export interface SyncCounter {
  date: string;
  value: number;
}

/** `version` — kassirlar, menyu va rasmlar ro'yxatining xeshi; o'zgarmagan bo'lsa ular qayta yuborilmaydi. */
export interface SyncSnapshot {
  version: string;
  unchanged: false;
  branch: { id: string; name: string };
  cashiers: SyncCashier[];
  menu: SyncMenu;
  images: SyncImage[];
  /**
   * Xodimlar tizimi markazning qaysi yo'lida (`UI_BASE` + `/`, masalan `/shorva/`) — offline kassadan "Online rejimga
   * qaytish" online kassadan o'tilmagan bo'lsa (yorliq bilan ochilgan) `<markaz manzili><uiBase>kassa` ga.
   */
  uiBase: string;
  counter: SyncCounter;
}

export type SyncSnapshotResponse = SyncSnapshot | { version: string; unchanged: true; counter: SyncCounter };

/** Offline buyurtma holati: pul olingan (`pending` yo'q) → "Tayyor"ni kassir bosadi; bekor qilinishi mumkin. */
export const OFFLINE_ORDER_STATUSES = ['preparing', 'ready', 'cancelled'] as const;
export type OfflineOrderStatus = (typeof OFFLINE_ORDER_STATUSES)[number];

/** Offline kassada yaratilgan buyurtma — markazga shu ko'rinishda yuboriladi (vaqtlar ISO). */
export interface SyncOrder {
  id: string;
  number: number;
  type: OrderType;
  items: OrderItem[];
  note: string;
  total: number;
  payment: PaymentMethod;
  split: PaymentSplit | null;
  status: OfflineOrderStatus;
  cashierId: string;
  createdAt: string;
  readyAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

/** `accepted` — markazda yozildi (yoki allaqachon bor edi): offline bazadan o'chiriladi. `rejected` — qayta yuborilmaydi. */
export interface SyncOrdersResult {
  accepted: string[];
  rejected: { id: string; code: string; detail?: string }[];
}

/** So'rov sarlavhasi: filial kaliti `br_….<maxfiy qism>` (admin "Filiallar" → "Offline kalit"). */
export const SYNC_KEY_HEADER = 'x-offline-key';
