import { Controller, Delete, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AttemptsGuard } from '../auth/attempts.guard';
import { Public } from '../auth/decorators';
import { requestOrigin } from './mobile-card.config';
import { CLIENT_KEY_HEADER, MobileCardsService } from './mobile-cards.service';

/**
 * Bog'langan kartalar (API.md 5.8) — login yo'q, karta telefonga bog'lanadi: har so'rovda `X-Client-Key` (ilova
 * birinchi ishga tushganda yaratgan maxfiy kalit). Bank tokeni ilovaga berilmaydi.
 */
@Controller('mobile/cards')
export class MobileCardsController {
  constructor(private readonly cards: MobileCardsService) {}

  /** `MobileCard[]` — shu telefonning kartalari (`{ id, maskedPan, createdAt }`). */
  @Public()
  @Get()
  list(@Headers(CLIENT_KEY_HEADER) key?: string) {
    return this.cards.list(key);
  }

  /** `201 { binding, paymentUrl, returnUrl }` — bank sahifasini WebView'da oching (pul yechilmaydi). */
  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('bind')
  bind(@Req() req: Request, @Headers(CLIENT_KEY_HEADER) key?: string) {
    return this.cards.startBinding(key, requestOrigin(req.host, req.protocol));
  }

  /** Bog'lash natijasi: `{ id, status: pending | active | failed, card }`. */
  @Public()
  @Get('bind/:id')
  binding(@Param('id') id: string, @Headers(CLIENT_KEY_HEADER) key?: string) {
    return this.cards.binding(key, id);
  }

  /** `204` — bankda uziladi va o'chadi. */
  @Public()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Headers(CLIENT_KEY_HEADER) key?: string): Promise<void> {
    await this.cards.remove(key, id);
  }
}
