import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { INGREDIENT_GROUPS, MOVEMENT_KINDS, PURCHASE_STATUSES, STOCK_UNITS } from '../common/enums';
import type { IngredientGroup, MovementKind, PurchaseStatus, StockUnit } from '../common/enums';
import { LocalizedTextDto } from '../common/localized.dto';
import { PageQuery } from '../common/pagination';

/** Qo'shish va tahrirlashda umumiy maydonlar (birlik — har birida o'zicha). */
class IngredientFieldsDto {
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @IsIn(INGREDIENT_GROUPS)
  group: IngredientGroup;

  @IsBoolean()
  active: boolean;

  /**
   * 1 birlik (qadoq bo'lsa — 1 dona, aks holda kg / l / dona) narxi, so'm (butun ≥ 0 — servisda `invalid_price`). Faqat
   * admin; berilmasa — o'zgarmaydi (qadoq hajmi o'zgarsa — yangi birlikka qayta hisoblanadi), `null` — narxsiz. Kirim
   * formasida oldindan yoziladi, har kirimda ta'minotchi kiritgan narxga yangilanadi.
   */
  @IsOptional()
  @IsNumber()
  lastPrice?: number | null;

  /**
   * Qadoq hajmi asosiy birlikda (g / ml / dona), butun 1–1 000 000 (servisda `invalid_qty`): 600 — 1 dona = 600 g.
   * Berilmasa — o'zgarmaydi (yangi mahsulotda — qadoqsiz), `null` — qadoqsiz.
   */
  @IsOptional()
  @IsNumber()
  packSize?: number | null;
}

export class UpdateIngredientDto extends IngredientFieldsDto {
  /**
   * Berilmasa yoki o'sha birlik — o'zgarmaydi. Boshqa birlik — faqat admin (`forbidden`). Qoldiq, chegara, retseptlar,
   * qadoq hajmi va hujjatlardagi sonlar o'zgarmaydi — endi yangi birlikda o'qiladi (kg / l ↔ dona: 5950 g → 5950 dona;
   * kg ↔ l — sonlar to'g'ri qoladi). kg / l ↔ dona: narx yuborilmasa bo'shatiladi, mahsulot tasdiq kutayotgan eski
   * kirimda bo'lsa — `pending_purchase`.
   */
  @IsOptional()
  @IsIn(STOCK_UNITS)
  unit?: StockUnit;
}

export class CreateIngredientDto extends IngredientFieldsDto {
  @IsIn(STOCK_UNITS)
  unit: StockUnit;
}

export class SetMinQtyDto {
  /** asosiy birlikda (g / ml / dona), butun son; 0 — kuzatilmaydi */
  @IsNumber()
  minQty: number;
}

export class SetTargetQtyDto {
  /** norma, asosiy birlikda (g / ml / dona), butun son; 0 — yozilmagan (chegara × 2, u ham yo'q — 10 birlik) */
  @IsNumber()
  targetQty: number;
}

export class StockQuery {
  @IsOptional()
  @IsString()
  warehouseId?: string;
}

export class MovementsQuery extends PageQuery {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  ingredientId?: string;

  @IsOptional()
  @IsIn(MOVEMENT_KINDS)
  kind?: MovementKind;

  @IsOptional()
  @IsString()
  refId?: string;
}

export class DocumentLineDto {
  @IsString()
  @MaxLength(40)
  ingredientId: string;

  /** ombor birligida (kg / l / dona; qadoq hajmi berilgan mahsulotda — donada), > 0 — servisda `invalid_qty` */
  @IsNumber()
  qty: number;
}

export class PurchaseLineDto extends DocumentLineDto {
  /**
   * 1 birlik (qadoq bo'lsa — 1 dona, aks holda kg / l / dona) narxi, so'm — ta'minotchi kiritadi (butun ≥ 0, servisda
   * `invalid_price`). Mahsulotning "oxirgi narxi" shunga yangilanadi. Berilmasa — oxirgi narx; u ham yo'q — `invalid_price`.
   */
  @IsOptional()
  @IsNumber()
  price?: number;
}

export class CreatePurchaseDto {
  @IsString()
  @MaxLength(40)
  warehouseId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items: PurchaseLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Faqat eski (2026-11-08 gacha yozilgan, tasdiq kutayotgan) kirim uchun. */
export class ApprovePurchaseDto {
  /** mahsulot id → 1 birlik (qatorda qadoq bo'lsa — 1 dona) narxi; berilmaganlari kirimdagi (oldingi) narxida qoladi */
  @IsOptional()
  @IsObject()
  prices?: Record<string, number>;
}

export class PurchasesQuery extends PageQuery {
  @IsOptional()
  @IsIn(PURCHASE_STATUSES)
  status?: PurchaseStatus;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}

export class CreateTransferDto {
  @IsString()
  @MaxLength(40)
  fromWarehouseId: string;

  @IsString()
  @MaxLength(40)
  toWarehouseId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentLineDto)
  items: DocumentLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class TransfersQuery extends PageQuery {
  /** shu ombordan chiqqan yoki kirgan ko'chirishlar */
  @IsOptional()
  @IsString()
  warehouseId?: string;
}
