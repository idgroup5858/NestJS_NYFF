import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RETURN_REASONS, type ReturnReason } from '../common/enums';

/** "Ishdaman" / "Ishda emasman". */
export class DutyDto {
  @IsBoolean()
  onDuty: boolean;
}

/** "Yetkazib bo'lmadi": sabab va izoh (masalan "3 marta qo'ng'iroq qildim"). */
export class ReturnOrderDto {
  @IsIn(RETURN_REASONS)
  reason: ReturnReason;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
