import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ROLES, type Role } from '../common/enums';

/**
 * Admin xodim qo'shadi / tahrirlaydi. Kuryer — `login` va `password` bilan (PIN'siz), boshqalar — `pin` bilan.
 * Tahrirda `pin` / `password` bo'sh qoldirilsa — eskisi qoladi.
 */
export class SaveUserDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsIn(ROLES)
  role: Role;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchId: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  pin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  login?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsBoolean()
  active: boolean;
}
