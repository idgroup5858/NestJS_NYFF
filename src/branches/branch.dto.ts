import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../common/geo.dto';
import { HHMM_PATTERN } from '../domain/work-hours';

const TIME_MESSAGE = "Vaqt 'HH:MM' ko'rinishida bo'lishi kerak";

export class WorkHoursDto {
  @Matches(HHMM_PATTERN, { message: TIME_MESSAGE })
  open: string;

  @Matches(HHMM_PATTERN, { message: TIME_MESSAGE })
  close: string;
}

export class SaveBranchDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(255)
  address: string;

  @IsString()
  @MaxLength(30)
  phone: string;

  @IsBoolean()
  active: boolean;

  /** online buyurtma qabul qilish vaqti; `null` yoki berilmasa — 24/7 */
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkHoursDto)
  workHours?: WorkHoursDto | null;
}

export class SaveDeliveryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LatLngDto)
  location: LatLngDto | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LatLngDto)
  zone: LatLngDto[];

  @IsNumber()
  fee: number;

  @IsOptional()
  @IsString()
  fallbackBranchId: string | null;

  @IsBoolean()
  onlineEnabled: boolean;
}

export class SetOnlineDto {
  @IsBoolean()
  enabled: boolean;
}

export class RouteQuery {
  @Type(() => Number)
  @IsNumber()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  lng: number;
}
