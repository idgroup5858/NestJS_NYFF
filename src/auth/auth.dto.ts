import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ROLES, type Role } from '../common/enums';

export class StaffQuery {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;
}

/** PIN bilan kirish — kassir, oshpaz yordamchisi, ta'minotchi (ism ochiq ro'yxatdan tanlanadi). */
export class LoginDto {
  @IsString()
  @MaxLength(40)
  userId: string;

  @IsString()
  @MaxLength(8)
  pin: string;

  /**
   * Kassa turgan filial (kirish ekranida tanlangan) — kassir va oshpaz yordamchisi uchun; ta'minotchida e'tiborga
   * olinmaydi. Bitta filialli xodimda ixtiyoriy (eski ilova yubormaydi).
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchId?: string;
}

/** Admin (`/auth/admin-login`) va kuryer (`/auth/courier-login`) — email va parol bilan. */
export class PasswordLoginDto {
  @IsString()
  @MaxLength(100)
  email: string;

  @IsString()
  @MaxLength(64)
  password: string;
}

export class UnlockDto {
  @IsString()
  @MaxLength(8)
  pin: string;
}

export class ChangePinDto {
  @IsString()
  @MaxLength(8)
  oldPin: string;

  @IsString()
  @MaxLength(8)
  newPin: string;
}

/** Admin o'z ismi, familiyasi va emailini o'zgartiradi. */
export class UpdateProfileDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(100)
  surname: string;

  @IsString()
  @MaxLength(100)
  email: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(64)
  oldPassword: string;

  @IsString()
  @MaxLength(64)
  newPassword: string;
}
