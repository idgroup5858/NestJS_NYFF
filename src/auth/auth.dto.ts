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

export class LoginDto {
  @IsString()
  @MaxLength(40)
  userId: string;

  @IsString()
  @MaxLength(8)
  pin: string;
}

/** Kuryer kirishi (mijoz ilovasi ichidagi yashirin oyna). */
export class CourierLoginDto {
  @IsString()
  @MaxLength(40)
  login: string;

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
