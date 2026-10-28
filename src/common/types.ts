import type { Lang, MobilePlatform, OnlinePayment, PaymentMethod } from './enums';

/** Uch tildagi matn (taom, kategoriya, ombor mahsuloti nomlari). */
export type LocalizedText = Record<Lang, string>;

/** Xaritadagi nuqta (WGS84, gradusda). */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Filialning ish vaqti (`HH:MM`, mahalliy vaqt). `close < open` — yarim tundan o'tadi (18:00–03:00). */
export interface WorkHours {
  open: string;
  close: string;
}

export interface RecipeLine {
  ingredientId: string;
  /** asosiy birlikda: g / ml / dona */
  qty: number;
}

export interface PurchaseItem {
  ingredientId: string;
  /** ombor birligida (kg / l / dona) */
  qty: number;
  /** 1 birlik narxi — admin kiritadi; tasdiqlanmaguncha `null` bo'lishi mumkin */
  price: number | null;
}

export interface TransferItem {
  ingredientId: string;
  /** ombor birligida (kg / l / dona) */
  qty: number;
}

export interface OrderItem {
  productId: string;
  /** sotilgan paytdagi nom va narx — keyin menyu o'zgarsa ham chek o'zgarmaydi */
  name: LocalizedText;
  price: number;
  qty: number;
}

/** Aralash to'lov: tur bo'yicha summalar (yig'indisi = buyurtma summasi). */
export type PaymentSplit = Partial<Record<PaymentMethod, number>>;

/** Mobil ilovadan kelgan buyurtma: mijoz, telefon, manzil (faqat dostavkada), to'lovi va joylashuvi. */
export interface OnlineInfo {
  platform: MobilePlatform;
  name: string;
  phone: string;
  address: string;
  payment: OnlinePayment;
  /** mijoz belgilagan joy (GPS) — dostavkada majburiy, filial shu bo'yicha tanlanadi */
  location: LatLng | null;
}
