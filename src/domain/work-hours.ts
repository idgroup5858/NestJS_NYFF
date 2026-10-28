import type { WorkHours } from '../common/types';

export const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** To'g'ri ish vaqti: ikkala soat `HH:MM`, bir xil emas (bir xil bo'lsa — kun bo'yi degani emas, xato). */
export function isValidWorkHours(hours: WorkHours): boolean {
  return HHMM_PATTERN.test(hours.open) && HHMM_PATTERN.test(hours.close) && hours.open !== hours.close;
}

/**
 * Hozir ish vaqti ichidami (mahalliy vaqt). `null` — belgilanmagan: 24/7. Ochilish soati kiradi, yopilishi kirmaydi;
 * `close < open` bo'lsa yarim tundan o'tadi (18:00–03:00 → kechqurun 18:00 dan ertalab 03:00 gacha).
 */
export function isWithinWorkHours(hours: WorkHours | null, now: Date): boolean {
  if (!hours) return true;
  const current = now.getHours() * 60 + now.getMinutes();
  const open = minutesOf(hours.open);
  const close = minutesOf(hours.close);
  return open < close ? current >= open && current < close : current >= open || current < close;
}
