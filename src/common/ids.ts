import { createHash, randomBytes } from 'node:crypto';

/** Noyob id: `ord_3f2a9c1b7e4d8a05`. Prefiks loglarda qaysi jadvalga tegishliligini ko'rsatadi. Frontend bilan bir xil. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/**
 * Kassa o'zi bergan buyurtma id'si (`newId('ord')` shakli): to'lov paytida internet uzilsa — qayta yuborilgan yoki
 * offline kassadan kelgan buyurtma ikki marta yozilmaydi.
 */
export const ORDER_ID_PATTERN = /^ord_[0-9a-f]{16}$/;

/** Uzun maxfiy satr (qurilma kaliti, mobil buyurtma tokeni). Bazada faqat [sha256] xeshi saqlanadi. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
