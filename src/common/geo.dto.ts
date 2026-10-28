import { IsNumber } from 'class-validator';

/** Faqat turi tekshiriladi — chegaralar (|lat| ≤ 90) servisda `invalid_location` bilan. */
export class LatLngDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}
