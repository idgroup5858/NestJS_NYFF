import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { appError } from '../common/errors';

/**
 * IP bo'yicha urinishlar chegarasi (PIN bilan kirish, qurilmani ulash) — bitta xodimning blokidan tashqari, hamma
 * xodimlarni ketma-ket sinab chiqishga ham to'siq. Javob bizning xato ko'rinishida: `too_many_attempts`.
 */
@Injectable()
export class AttemptsGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw appError('too_many_attempts');
  }
}
