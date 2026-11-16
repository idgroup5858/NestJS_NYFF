import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { AuthUser } from '../auth/auth.types';

export interface ShiftClosed {
  shiftId: string;
  /**
   * yopgan xodim: kassir o'zi, admin (kassir yopmay ketgan smena) yoki [auto] da — shu filialga kirgan keyingi kassir;
   * noma'lum — `null`
   */
  closedBy: AuthUser | null;
  /** kassir topshirmay ketgan — shu filialda boshqa kassir kirganda avtomatik yopildi (2026-11-17) */
  auto?: boolean;
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
