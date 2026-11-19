import { Body, Controller, Get, Header, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AttemptsGuard } from '../auth/attempts.guard';
import { Public } from '../auth/decorators';
import { TrackingQuery } from '../orders/order.dto';
import { requestOrigin } from './mobile-card.config';
import { CLIENT_KEY_HEADER } from './mobile-cards.service';
import { MobilePaymentDto } from './mobile-payment.dto';
import { MobilePaymentsService } from './mobile-payments.service';

/** Bank to'lovdan keyin brauzerni shu sahifaga qaytaradi. Ilova WebView'da uni ochmasdan ushlaydi — bu zaxira. */
function returnPage(success: boolean): string {
  const [title, text] = success
    ? ["To'lov qabul qilindi", "Ilovaga qayting — buyurtmangiz filialga yuborildi."]
    : ["To'lov o'tmadi", "Ilovaga qayting va qaytadan urinib ko'ring yoki naqd to'lovni tanlang."];
  const [titleRu, textRu] = success
    ? ['Оплата принята', 'Вернитесь в приложение — заказ отправлен в филиал.']
    : ['Оплата не прошла', 'Вернитесь в приложение и попробуйте снова или выберите оплату наличными.'];
  return `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: system-ui, -apple-system, sans-serif; background: #121212; color: #fff; text-align: center; }
  main { padding: 24px; max-width: 420px; }
  h1 { font-size: 22px; margin: 0 0 8px; color: ${success ? '#FFC20E' : '#ff6b6b'}; }
  p { margin: 0 0 20px; color: #ccc; line-height: 1.5; }
  hr { border: 0; border-top: 1px solid #333; margin: 20px 0; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${text}</p>
  <hr>
  <h1>${titleRu}</h1>
  <p>${textRu}</p>
</main>
</body>
</html>`;
}

/**
 * Mobil ilovada karta bilan to'lov (Milliy Ecom / NBU) — API.md 5.7. Ochiq (mijoz tokensiz), to'lov holati — faqat
 * `trackingToken` bilan (buyurtma kuzatuvidagidek).
 */
@Controller('mobile/payments')
export class MobilePaymentsController {
  constructor(private readonly payments: MobilePaymentsService) {}

  /** `{ cash: true, card }` — `card: false` bo'lsa ilovada "Karta" — "Tez kunda". */
  @Public()
  @Get('methods')
  methods() {
    return this.payments.methods();
  }

  @Public()
  @Get('return')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  returnPage(@Query('result') result?: string) {
    return returnPage(result === 'success');
  }

  /**
   * Javob `201`: `{ payment, paymentUrl, returnUrl, trackingToken }`. Qaytish manzili domeni — ilova murojaat qilgan
   * manzil (Android'da qattiq yozilgan server).
   */
  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  create(@Body() dto: MobilePaymentDto, @Req() req: Request, @Headers(CLIENT_KEY_HEADER) clientKey?: string) {
    return this.payments.create(dto, requestOrigin(req.host, req.protocol), new Date(), clientKey);
  }

  /** To'lov holati: `X-Order-Token` sarlavhasi yoki `?token=`. */
  @Public()
  @Get(':id')
  get(@Param('id') id: string, @Query() query: TrackingQuery, @Headers('x-order-token') header?: string) {
    return this.payments.get(id, header || query.token);
  }
}
