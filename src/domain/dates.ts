/**
 * Sanalar — frontend `src/domain/dates.ts` bilan bir xil. Mahalliy vaqt jarayon vaqt zonasidan olinadi (`.env` dagi
 * `TZ=Asia/Tashkent`, `main.ts` boshida yuklanadi) — kunlik buyurtma raqami va hisobot kunlari shunga bog'liq.
 */

/** Mahalliy sana `YYYY-MM-DD` */
export type DateKey = string;

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pad = (value: number) => String(value).padStart(2, '0');

/** Mahalliy vaqt bo'yicha sana: `2026-10-23`. Buyurtma raqami har kuni shu kalit bo'yicha 1 dan boshlanadi. */
export function dateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `2026-10-23` → mahalliy yarim tun. */
export function parseDateKey(key: DateKey): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Format va haqiqiy kalendar sanasi (`2026-02-30` — yo'q; Postgres'ga yuborilsa xato beradi). */
export function isRealDateKey(key: string): boolean {
  return DATE_KEY_PATTERN.test(key) && dateKey(parseDateKey(key)) === key;
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

/** [from] dan [to] gacha (ikkalasi ham kiradi) har bir kun; eng ko'pi 400 kun. */
export function dateRange(from: DateKey, to: DateKey): DateKey[] {
  const days: DateKey[] = [];
  for (let key = from; key <= to && days.length < 400; key = addDays(key, 1)) days.push(key);
  return days;
}

/** SQL'da `AT TIME ZONE` uchun — jarayon bilan bir xil zona. */
export function appTimeZone(): string {
  return process.env.TZ || 'Asia/Tashkent';
}
