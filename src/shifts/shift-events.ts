import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { AuthUser } from '../auth/auth.types';

export interface ShiftClosed {
  shiftId: string;
  /** yopgan xodim: kassir o'zi yoki admin (kassir yopmay ketgan smena); noma'lum — `null` */
  closedBy: AuthUser | null;
}

/**
 * Smena yopildi (tranzaksiya tugagach) — Telegram botga hisobot shu xabar bo'yicha ketadi. Alohida servis — smenalar
 * moduli Telegram moduliga bog'lanmasin (Telegram → AI → smenalar — aylana bog'lanish bo'lardi).
 */
@Injectable()
export class ShiftEvents {
  private readonly emitter = new EventEmitter();

  closed(event: ShiftClosed): void {
    this.emitter.emit('closed', event);
  }

  onClosed(listener: (event: ShiftClosed) => void): void {
    this.emitter.on('closed', listener);
  }
}
