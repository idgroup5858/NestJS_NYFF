import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Purchase } from './purchase.entity';

/**
 * Yangi kirim saqlandi (tranzaksiya tugagach) — Telegram botga "Yangi kirim" xabari shu bo'yicha ketadi. Alohida
 * servis — ombor moduli Telegram moduliga bog'lanmasin (`ShiftEvents`, `LowStockEvents` dagidek).
 */
@Injectable()
export class PurchaseEvents {
  private readonly emitter = new EventEmitter();

  created(purchase: Purchase): void {
    try {
      this.emitter.emit('created', purchase);
    } catch {
      // tinglovchi xatosi so'rovni yiqitmasin — kirim allaqachon saqlangan
    }
  }

  onCreated(listener: (purchase: Purchase) => void): void {
    this.emitter.on('created', listener);
  }
}
