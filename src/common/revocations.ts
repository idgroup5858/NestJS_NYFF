import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * Kirish huquqi bekor bo'ldi: xodim bloklandi / roli yoki filiali o'zgardi; filialning TV / kiosk kodi yangilandi.
 * Socket.IO ulanishlari shu xabar bo'yicha darhol uziladi (HTTP so'rovlar baribir har safar tekshiriladi). Alohida
 * servis — xodimlar va ekran kodlari modullari realtime moduliga bog'lanmasin (aylana bog'lanish bo'lmasin).
 */
@Injectable()
export class Revocations {
  private readonly emitter = new EventEmitter();

  /**
   * Xodim huquqi bekor bo'ldi. [remainingBranchIds] berilsa — faqat filiallaridan biri olib tashlangan: shu ro'yxatda
   * yo'q filialdagi ulanishlar uziladi, qolganlari ishlayveradi; berilmasa — hammasi.
   */
  user(userId: string, remainingBranchIds?: string[]): void {
    this.emitter.emit('user', userId, remainingBranchIds);
  }

  onUser(listener: (userId: string, remainingBranchIds?: string[]) => void): void {
    this.emitter.on('user', listener);
  }

  /** Filialning ekran kodi yangilandi (`tv` — eski kod bilan ulangan TV'lar uziladi; kioskda socket yo'q). */
  screenCode(kind: 'tv' | 'kiosk', branchId: string): void {
    this.emitter.emit('screen_code', kind, branchId);
  }

  onScreenCode(listener: (kind: 'tv' | 'kiosk', branchId: string) => void): void {
    this.emitter.on('screen_code', listener);
  }
}

@Global()
@Module({ providers: [Revocations], exports: [Revocations] })
export class RevocationsModule {}
