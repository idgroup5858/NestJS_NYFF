import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ROLES, type Role } from '../common/enums';

/**
 * Admin xodim qo'shadi / tahrirlaydi. Admin va kuryer — `email` va `password` bilan (PIN'siz), boshqalar — `pin` bilan.
 * Tahrirda `pin` / `password` bo'sh qoldirilsa — eskisi qoladi. Kassir va oshpaz yordamchisi — `branchIds` (kamida
 * bitta filial); boshqa rollarda e'tiborga olinmaydi.
 */
export class SaveUserDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  surname?: string;

  @IsIn(ROLES)
  role: Role;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  branchIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(8)
  pin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsBoolean()
  active: boolean;
}
