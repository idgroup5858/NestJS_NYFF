import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MobileOrderDto } from '../orders/order.dto';

/**
 * `POST /mobile/payments`: buyurtma (`POST /mobile/orders` niki, `online.payment: card`) + ixtiyoriy saqlangan karta.
 * `cardId` bo'lsa — bank sahifasisiz, shu kartadan darhol yechiladi (`X-Client-Key` — o'sha telefonniki bo'lishi shart).
 */
export class MobilePaymentDto extends MobileOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cardId?: string;
}
