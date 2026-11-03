import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  Min,
  ValidateNested,
} from 'class-validator';
import { ORDER_TYPES, PAYMENT_METHODS, type OrderType, type PaymentMethod } from '../common/enums';
import { ORDER_ID_PATTERN } from '../common/ids';
import { LocalizedTextDto } from '../common/localized.dto';
import { PaymentSplitDto } from '../orders/order.dto';
import { OFFLINE_ORDER_STATUSES, type OfflineOrderStatus } from './sync.types';

/** Bir so'rovda yuboriladigan buyurtmalar chegarasi — ko'pi bo'lsa offline server bo'lib yuboradi. */
export const SYNC_BATCH_SIZE = 200;

export class SnapshotQuery {
  /** offline serverdagi nusxa versiyasi — o'zgarmagan bo'lsa menyu va kassirlar qayta yuborilmaydi */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  since?: string;
}

export class SyncOrderItemDto {
  @IsString()
  @MaxLength(40)
  productId: string;

  /** sotilgan paytdagi nom (offline menyudan) */
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @IsNumber()
  price: number;

  @IsNumber()
  qty: number;
}

/** Shakli tekshiriladi; summa, miqdor va to'lov qoidalari — servisda (oddiy kassa buyurtmasi bilan bir xil). */
export class SyncOrderDto {
  @Matches(ORDER_ID_PATTERN)
  id: string;

  @IsInt()
  @Min(1)
  number: number;

  @IsIn(ORDER_TYPES)
  type: OrderType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncOrderItemDto)
  items: SyncOrderItemDto[];

  @IsString()
  @MaxLength(500)
  note: string;

  @IsNumber()
  total: number;

  @IsIn(PAYMENT_METHODS)
  payment: PaymentMethod;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentSplitDto)
  split: PaymentSplitDto | null;

  @IsIn(OFFLINE_ORDER_STATUSES)
  status: OfflineOrderStatus;

  @IsString()
  @MaxLength(40)
  cashierId: string;

  @IsISO8601()
  createdAt: string;

  @IsOptional()
  @IsISO8601()
  readyAt: string | null;

  @IsOptional()
  @IsISO8601()
  cancelledAt: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cancelledBy: string | null;
}

export class SyncOrdersDto {
  @IsArray()
  @ArrayMaxSize(SYNC_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => SyncOrderDto)
  orders: SyncOrderDto[];
}
