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

export class UpdateIngredientDto {
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @IsIn(INGREDIENT_GROUPS)
  group: IngredientGroup;

  @IsBoolean()
  active: boolean;

  /**
   * 1 birlik (kg / l / dona) narxi, so'm (butun ≥ 0 — servisda `invalid_price`). Faqat admin; berilmasa — o'zgarmaydi,
   * `null` — narxsiz. Keyingi kirimga avtomatik yoziladi, kirim tasdiqlanganda yangilanadi.
   */
  @IsOptional()
  @IsNumber()
  lastPrice?: number | null;
}

export class CreateIngredientDto extends UpdateIngredientDto {
  /** faqat yangi mahsulotda — keyin o'zgartirilmaydi (qoldiq va retseptlar shu birlikda hisoblangan) */
  @IsIn(STOCK_UNITS)
  unit: StockUnit;
}

export class SetMinQtyDto {
  /** asosiy birlikda (g / ml / dona), butun son; 0 — kuzatilmaydi */
  @IsNumber()
  minQty: number;
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

  /** ombor birligida (kg / l / dona), > 0 — servisda `invalid_qty` */
  @IsNumber()
  qty: number;
}

export class CreatePurchaseDto {
  @IsString()
  @MaxLength(40)
  warehouseId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentLineDto)
  items: DocumentLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ApprovePurchaseDto {
  /** mahsulot id → 1 birlik narxi; berilmaganlari kirimdagi (oldingi) narxida qoladi */
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
