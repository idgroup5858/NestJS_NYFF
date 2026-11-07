/** ReactJS_NYFF `src/domain/types.ts` dagi ro'yxatlar bilan bir xil — qiymatlar API orqali o'zgarishsiz o'tadi. */

export const LANGS = ['uz', 'ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * `kitchen` — oshpaz yordamchisi: ovqatni oshxonadan olib chiqib "Tayyor" bosadi. `courier` — kuryer (mobil ilova):
 * istalgan filialning dostavka buyurtmasini oladi, lekin bir vaqtda faqat bitta filialnikini.
 */
export const ROLES = ['admin', 'cashier', 'kitchen', 'supplier', 'courier'] as const;
export type Role = (typeof ROLES)[number];

/** Kassir va oshpaz yordamchisi filialga bog'lanadi; admin, ta'minotchi va kuryer — butun tarmoq uchun. */
export function roleNeedsBranch(role: Role): boolean {
  return role === 'cashier' || role === 'kitchen';
}

/**
 * Admin (web, `/admin`) va kuryer (mobil ilova) — email va parol bilan kiradi, PIN'i yo'q; ismlari ochiq kirish
 * ro'yxatida chiqmaydi. Qolganlar (kassir, oshpaz yordamchisi, ta'minotchi) — ro'yxatdan ism + PIN.
 */
export function usesPassword(role: Role): boolean {
  return role === 'admin' || role === 'courier';
}

export const WAREHOUSE_KINDS = ['central', 'branch'] as const;
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];

/** Ombor birligi: kirim, qoldiqni ko'rsatish va narx shu birlikda. Asosiy birligi: kg → g, l → ml, pcs → dona. */
export const STOCK_UNITS = ['kg', 'l', 'pcs'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const INGREDIENT_GROUPS = [
  'bread',
  'meat',
  'seafood',
  'dairy',
  'vegetables',
  'fruits',
  'frozen',
  'sauces',
  'grocery',
  'sweets',
  'drinks',
  'coffee',
  'packaging',
  'cleaning',
  'other',
] as const;
export type IngredientGroup = (typeof INGREDIENT_GROUPS)[number];
/** Taom tarkibida (kioskda) ko'rsatilmaydigan guruhlar — mijozga "tarkibi: quti, yog', ziravor" deb chiqmasin. */
export const NON_COMPOSITION_GROUPS: readonly IngredientGroup[] = ['grocery', 'packaging', 'cleaning', 'other'];

/**
 * Kirim holati. 2026-11-08 dan kirim darhol omborga qo'shiladi va `approved` bo'lib saqlanadi (admin tasdiqlamaydi);
 * `pending` / `rejected` — undan oldin yozilgan kirimlar (eski kutayotganini admin bir marta tasdiqlaydi yoki rad etadi).
 */
export const PURCHASE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const MOVEMENT_KINDS = ['purchase', 'transfer_in', 'transfer_out', 'sale', 'sale_cancel'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_SOURCES = ['cashier', 'kiosk', 'mobile'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const MOBILE_PLATFORMS = ['android', 'ios'] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

/**
 * pending (kioskdan — kassada to'lanmagan; mobil ilovadan — kassir qabul qilmagan) → preparing (to'langan / qabul
 * qilingan, chek oshxonada) → ready (oshpaz yordamchisi "Tayyor" bosdi). Kassir (yoki admin) istalgan bosqichda
 * bekor qila oladi.
 */
export const ORDER_STATUSES = ['pending', 'preparing', 'ready', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Server o'zi bekor qilgan mobil buyurtma sababi (kassir / admin bekor qilsa — `null`):
 * `timeout` — filial 5 daqiqada qabul qilmadi; `branch_closed` — kutish paytida filial yopildi;
 * `no_branch` — buyurtmani o'tkazadigan ochiq filial yo'q.
 */
export const CANCEL_REASONS = ['timeout', 'branch_closed', 'no_branch'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * Kuryer buyurtmani yetkaza olmadi: `no_answer` — mijoz javob bermadi; `wrong_address` — manzil topilmadi / noto'g'ri;
 * `refused` — mijoz olmadi; `other` — boshqa (izohda). Buyurtma filialga qaytadi, keyingisini admin / kassir hal qiladi.
 */
export const RETURN_REASONS = ['no_answer', 'wrong_address', 'refused', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'click'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Mobil ilovada mijoz tanlaydigan to'lov: `click` — ilovada to'langan, `cash` — kuryerga / filialda naqd. */
export const ONLINE_PAYMENTS = ['click', 'cash'] as const;
export type OnlinePayment = (typeof ONLINE_PAYMENTS)[number];

export const EXPENSE_KINDS = ['electricity', 'gas', 'water', 'internet', 'other'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

