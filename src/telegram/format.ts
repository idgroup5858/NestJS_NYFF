/** Bot tizim xabarlari (smena hisoboti, zaxira nusxa) uchun ko'rinishlar. */

/** `12 345 000 so'm` */
export function som(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `02.11.2026 09:05` — mahalliy vaqt (jarayon zonasi, `TZ=Asia/Tashkent`). */
export function dateTime(date: Date): string {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
