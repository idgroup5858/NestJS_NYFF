import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * Filial HR tizimidan bitta o'tish. Shakli yumshoq tekshiriladi: tabel raqami son bo'lmasa yoki tugma «Kirish» /
 * «Chiqish» bo'lmasa — xato emas, shunchaki saqlanmaydi (bitta noto'g'ri qator butun to'plamni rad ettirmasin).
 */
export class HrEventDto {
  /** terminaldagi `employeeNo` (HR'da — butun son) */
  @IsString()
  @MaxLength(32)
  employeeNo: string;

  @IsISO8601({ strict: true })
  occurredAt: string;

  /** `checkIn` | `checkOut` (boshqasi — saqlanmaydi) */
  @IsString()
  @MaxLength(16)
  status: string;

  /** terminal nomi */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  device?: string;
}

export class HrEventsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => HrEventDto)
  events: HrEventDto[];
}

/** Login / blokdan chiqish ekranidan ruxsat so'rash — PIN bilan (kassir hali kirmagan). */
export class FaceIdRequestDto {
  @IsString()
  @MaxLength(40)
  userId: string;

  @IsString()
  @MaxLength(8)
  pin: string;

  @IsString()
  @MaxLength(40)
  branchId: string;
}

export class SetFaceIdDto {
  @IsBoolean()
  enabled: boolean;
}
