import { createHash, randomBytes } from 'node:crypto';

/** Noyob id: `ord_3f2a9c1b7e4d8a05`. Prefiks loglarda qaysi jadvalga tegishliligini ko'rsatadi. Frontend bilan bir xil. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** Uzun maxfiy satr (qurilma kaliti, mobil buyurtma tokeni). Bazada faqat [sha256] xeshi saqlanadi. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
