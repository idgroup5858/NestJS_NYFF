import * as bcrypt from 'bcrypt';

/** Noto'g'ri PIN shuncha marta ketma-ket kiritilsa — [PIN_LOCK_MS] ga blok (4 xonali PIN'da atigi 10 000 variant). */
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 5 * 60_000;

/** PIN: faqat raqamlar, 4 tadan 8 tagacha. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/**
 * Kuryer logini va paroli (admin ochib beradi; kuryer ilovasi — mijoz ilovasi ichida, ismlar ro'yxatisiz). Login katta /
 * kichik harfni farqlamaydi — kichik harfda saqlanadi. Parol xeshi PIN'niki bilan bir joyda (`pinHash`): bloklanish va
 * urinishlar chegarasi bir xil.
 */
export const normalizeLogin = (login: string): string => login.trim().toLowerCase();

/** Login: lotin harflari, raqam, `.`, `_`, `-` — 3 tadan 40 tagacha. */
export function isValidLogin(login: string): boolean {
  return /^[a-z0-9._-]{3,40}$/.test(login);
}

/** Parol: 6 tadan 64 tagacha belgi. */
export function isValidPassword(password: string): boolean {
  return password.length >= 6 && password.length <= 64;
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export function comparePin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
