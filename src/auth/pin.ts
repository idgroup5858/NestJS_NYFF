import * as bcrypt from 'bcrypt';

/** Noto'g'ri PIN shuncha marta ketma-ket kiritilsa — [PIN_LOCK_MS] ga blok (4 xonali PIN'da atigi 10 000 variant). */
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 5 * 60_000;

/** PIN: faqat raqamlar, 4 tadan 8 tagacha. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/**
 * Admin va kuryer emaili va paroli (`usesPassword`): email katta / kichik harfni farqlamaydi — kichik harfda saqlanadi
 * va takrorlanmaydi. Parol xeshi PIN'niki bilan bir joyda (`pinHash`): bloklanish va urinishlar chegarasi bir xil.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const EMAIL_MAX_LENGTH = 100;

/** Oddiy shakl tekshiruvi: `nimadir@domen.uz` (bo'sh joysiz, bitta `@`, domenda nuqta). Pochta yuborilmaydi. */
export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Parol: 8 tadan 64 tagacha belgi. */
export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 64;
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export function comparePin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
