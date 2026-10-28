import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';
import { PageQuery } from '../common/pagination';

export class ShiftListQuery extends PageQuery {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  cashierId?: string;

  /** `true` — faqat ochiq, `false` — faqat yopilgan */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  open?: boolean;

  /**
   * Oraliq (ISO): smena shu oraliq bilan kesishsa chiqadi — `to` dan oldin ochilgan va `from` dan keyin yopilgan
   * (yoki hali ochiq)
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
