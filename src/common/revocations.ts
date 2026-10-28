import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * Kirish huquqi bekor bo'ldi: xodim bloklandi / roli yoki filiali o'zgardi. Socket.IO ulanishlari shu xabar bo'yicha
 * darhol uziladi (HTTP so'rovlar baribir har safar tekshiriladi). Alohida servis — xodimlar moduli realtime moduliga
 * bog'lanmasin (aylana bog'lanish bo'lmasin).
 */
@Injectable()
export class Revocations {
  private readonly emitter = new EventEmitter();

  user(userId: string): void {
    this.emitter.emit('user', userId);
  }

  onUser(listener: (userId: string) => void): void {
    this.emitter.on('user', listener);
  }
}

@Global()
@Module({ providers: [Revocations], exports: [Revocations] })
export class RevocationsModule {}
