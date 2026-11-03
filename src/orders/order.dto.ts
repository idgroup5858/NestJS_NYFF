import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MOBILE_PLATFORMS,
  ONLINE_PAYMENTS,
  ORDER_SOURCES,
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  type MobilePlatform,
  type OnlinePayment,
  type OrderSource,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
} from '../common/enums';
import { LatLngDto } from '../common/geo.dto';
import { ORDER_ID_PATTERN } from '../common/ids';
import { PageQuery } from '../common/pagination';

/**
 * Faqat shakli tekshiriladi; qoidalar (soni butun ≥ 1, aralash to'lov yig'indisi, telefon…) servisda — frontend bilan
 * bir xil xato kodlari bilan.
 */

export class OrderLineDto {
  @IsString()
  @MaxLength(40)
  productId: string;

  @IsNumber()
  qty: number;
  // taomga izoh yo'q (2026-10-27): eski ilova `note` yuborsa — `whitelist` jimgina tashlaydi
}

export class PaymentSplitDto {
  @IsOptional()
  @IsNumber()
  cash?: number;

  @IsOptional()
  @IsNumber()
  card?: number;

  @IsOptional()
  @IsNumber()
  click?: number;
}

class OrderBaseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Kassir buyurtmasi: filial va kassir — tokendan, to'lov majburiy. */
export class CreateOrderDto extends OrderBaseDto {
  /**
   * Kassa o'zi bergan id (`ord_` + 16 ta hex): javob kelmay qolsa (internet uzildi) shu id bilan qayta yuborilgan
   * buyurtma ikkinchi marta yozilmaydi — birinchisi qaytadi. Berilmasa — server o'zi beradi.
   */
  @IsOptional()
  @Matches(ORDER_ID_PATTERN)
  id?: string;

  @IsIn(ORDER_TYPES)
  type: OrderType;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  payment: PaymentMethod | null;

  /** aralash to'lov (kamida 2 tur, yig'indisi = buyurtma summasi); berilsa `payment` eng katta qismdan olinadi */
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentSplitDto)
  split?: PaymentSplitDto | null;
}

/** Kiosk: filial — kirish ekranida tanlangani. `payment: null` — "kassada to'layman" (buyurtma kassirni kutadi). */
export class KioskOrderDto extends OrderBaseDto {
  @IsString()
  @MaxLength(40)
  branchId: string;

  @IsIn(['dine_in', 'takeaway'])
  type: 'dine_in' | 'takeaway';

  @IsOptional()
  @IsIn(['card', 'click'])
  payment: 'card' | 'click' | null;
}

export class OnlineInfoDto {
  @IsIn(MOBILE_PLATFORMS)
  platform: MobilePlatform;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(30)
  phone: string;

  /** uy, xonadon, mo'ljal — matn (dostavkada majburiy) */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsIn(ONLINE_PAYMENTS)
  payment: OnlinePayment;

  /** mijoz joyi (GPS) — dostavkada majburiy: filialni server shu bo'yicha tanlaydi */
  @IsOptional()
  @ValidateNested()
  @Type(() => LatLngDto)
  location?: LatLngDto | null;
}

/**
 * Mobil ilova buyurtmasi. Dostavkada filial yuborilmaydi (yuborilsa ham e'tiborga olinmaydi) — server joylashuv
 * bo'yicha tanlaydi; olib ketishda filialni mijoz tanlaydi (yopiq bo'lsa — `branch_closed`).
 */
export class MobileOrderDto extends OrderBaseDto {
  @IsIn(ORDER_TYPES)
  type: OrderType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchId?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => OnlineInfoDto)
  online: OnlineInfoDto;
}

/** Kiosk buyurtmasining pulini olish / mobil buyurtmani qabul qilish. Mobilda to'lov — mijoz tanlagani. */
export class ConfirmOrderDto {
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  payment?: PaymentMethod;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentSplitDto)
  split?: PaymentSplitDto | null;
}

export class BranchScopeQuery {
  /** admin va TV uchun; kassir va oshpaz yordamchisi doim o'z filialini ko'radi */
  @IsOptional()
  @IsString()
  branchId?: string;
}

export class OrdersQuery extends PageQuery {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsIn(ORDER_SOURCES)
  source?: OrderSource;

  @IsOptional()
  @IsIn(ORDER_TYPES)
  type?: OrderType;

  @IsOptional()
  @IsString()
  shiftId?: string;

  /** to'lov turi — aralash to'lovda o'sha qismi bor buyurtma ham chiqadi */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  payment?: PaymentMethod;

  @IsOptional()
  @IsString()
  cashierId?: string;

  @IsOptional()
  @IsString()
  courierId?: string;

  /** buyurtma raqami (filialda kunlik) — bir nechta kun / filialda bir xil raqam bo'lishi mumkin */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  number?: number;

  /** yaratilgan vaqti oralig'i (ISO): `from` kiradi, `to` kirmaydi */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class TrackingQuery {
  @IsOptional()
  @IsString()
  token?: string;
}
