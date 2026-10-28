import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { EXPENSE_KINDS, type ExpenseKind } from '../common/enums';
import { DATE_KEY_PATTERN } from '../domain/dates';

export class CreateExpenseDto {
  @IsString()
  @MaxLength(40)
  branchId: string;

  @IsIn(EXPENSE_KINDS)
  kind: ExpenseKind;

  /** so'm, butun son > 0 — servisda `invalid_amount` */
  @IsNumber()
  amount: number;

  /** `YYYY-MM-DD` */
  @IsString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ExpensesQuery {
  @IsOptional()
  @IsString()
  branchId?: string;

  /** `YYYY-MM-DD`, ikkalasi ham kiradi */
  @IsOptional()
  @Matches(DATE_KEY_PATTERN)
  from?: string;

  @IsOptional()
  @Matches(DATE_KEY_PATTERN)
  to?: string;
}
