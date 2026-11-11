import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LocalizedTextDto } from '../common/localized.dto';

export class SaveCategoryDto {
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @IsString()
  @MaxLength(255)
  image: string;

  /** ikonka manzili; bo'sh satr — ikonkasiz */
  @IsString()
  @MaxLength(255)
  icon: string;

  @IsBoolean()
  active: boolean;
}

export class RecipeLineDto {
  @IsString()
  @MaxLength(40)
  ingredientId: string;

  /** asosiy birlikda (g / ml / dona), butun son ≥ 1 — servisda `invalid_qty` */
  @IsNumber()
  qty: number;
}

export class SaveProductDto {
  @IsString()
  @MaxLength(40)
  categoryId: string;

  @ValidateNested()
  @Type(() => LocalizedTextDto)
  name: LocalizedTextDto;

  @IsString()
  @MaxLength(255)
  image: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  recipe: RecipeLineDto[];

  /** barcha filiallarda bir xil narx, so'm — butun son > 0 (servisda `invalid_price`) */
  @IsNumber()
  price: number;

  /** taom vaqtincha sotilmaydigan filiallar; bo'sh — hamma filialda sotuvda */
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  unavailableBranchIds: string[];

  @IsBoolean()
  active: boolean;

  /** `false` — oshxona chekiga chiqmaydi (tayyor ichimlik); berilmasa — `true` (yangi) yoki o'zgarmaydi (tahrirda) */
  @IsOptional()
  @IsBoolean()
  kitchen?: boolean;

  /** `true` — truck chekiga chiqadi (`kitchen` dan mustaqil); berilmasa — `false` (yangi) yoki o'zgarmaydi (tahrirda) */
  @IsOptional()
  @IsBoolean()
  truck?: boolean;

  /** `true` — faqat zalda beriladi (choynakdagi choy); berilmasa — `false` (yangi) yoki o'zgarmaydi (tahrirda) */
  @IsOptional()
  @IsBoolean()
  dineInOnly?: boolean;
}

export class MoveDto {
  /** -1 — bir pog'ona yuqoriga, 1 — pastga */
  @IsIn([-1, 1])
  direction: -1 | 1;
}

export class MenuQuery {
  @IsString()
  branchId: string;

  /**
   * `true` — kassa uchun: shu filialda vaqtincha sotilmaydigan faol taomlar ham (`price: null` — "Sotilmaydi" deb
   * ko'rsatiladi) va taomsiz faol kategoriyalar ham. Berilmasa — faqat sotuvdagilar (kiosk, mobil ilova).
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  all?: boolean;
}
