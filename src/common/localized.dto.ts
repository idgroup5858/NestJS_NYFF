import { IsString, MaxLength } from 'class-validator';

/** Uch tildagi nom. O'zbekchasi majburiy (servisda `name_required`); ruscha / inglizcha bo'sh bo'lishi mumkin. */
export class LocalizedTextDto {
  @IsString()
  @MaxLength(200)
  uz: string;

  @IsString()
  @MaxLength(200)
  ru: string;

  @IsString()
  @MaxLength(200)
  en: string;
}
