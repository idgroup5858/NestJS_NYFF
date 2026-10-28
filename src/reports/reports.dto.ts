import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DATE_KEY_PATTERN } from '../domain/dates';

export class SalesReportQuery {
  /** mahalliy sana `YYYY-MM-DD`, ikkalasi ham kiradi; `from > to` — bo'sh hisobot (xato emas) */
  @IsString()
  @Matches(DATE_KEY_PATTERN)
  from: string;

  @IsString()
  @Matches(DATE_KEY_PATTERN)
  to: string;

  /** berilmasa — barcha filiallar */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchId?: string;
}
