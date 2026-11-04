/**
 * FaceID qoidasi (2026-11-04): kassir terminalda «Kirish» / «Chiqish» tugmasini bosib yuzini ko'rsatadi, filial HR
 * tizimi buni markazga yuboradi. Kassa shu hodisalarga qarab ruxsat beradi. Filialda tekshiruv yoqilgan bo'lsa
 * (`branches.faceIdRequired`) — `FaceIdService` shu funksiyani chaqiradi; ruxsat bo'lmasa, admin Telegram orqali bir
 * martalik ruxsat berishi mumkin.
 */

/** Terminal tugmasi: «Kirish» va «Chiqish» (Tushlik / Qo'shimcha ish va tugmasiz o'tish hisobga olinmaydi). */
export const FACEID_STATUSES = ['checkIn', 'checkOut'] as const;
export type FaceIdStatus = (typeof FACEID_STATUSES)[number];

export const isFaceIdStatus = (value: unknown): value is FaceIdStatus =>
  typeof value === 'string' && (FACEID_STATUSES as readonly string[]).includes(value);

/**
 * Kassa nima qilmoqchi: `open` — yangi smena ochish (PIN bilan kirganda, ochiq smena yo'q); `resume` — ochiq smenani
 * davom ettirish (PIN bilan qayta kirish, blokdan chiqish); `close` — "Smenani topshirish".
 */
export type FaceIdNeed = 'open' | 'resume' | 'close';

/** Smena ochish uchun «Kirish», topshirish uchun «Chiqish» — shuncha vaqt ichida bo'lishi kerak. */
export const FACEID_WINDOW_MS = 10 * 60_000;

/** «Kirish» dan keyin kassir shu vaqtgacha filialda hisoblanadi (smena uzunligi) — blokdan chiqishda terminal shart emas. */
export const FACEID_PRESENCE_MS = 16 * 3_600_000;

/** Kassirning oxirgi Kirish / Chiqish hodisasi (qaysi filialda bo'lishidan qat'i nazar). */
export interface LastFaceIdEvent {
  branchId: string;
  status: FaceIdStatus;
  occurredAt: Date;
}

/**
 * Ruxsat bormi. Hammasi kassirning **oxirgi** hodisasiga qarab — boshqa filialda «Kirish» bosgan bo'lsa, bu filialda
 * endi kira olmaydi (smenasi ochiq qolgan bo'lsa ham):
 *  - `open` — oxirgisi shu filialda «Kirish», 10 daqiqa ichida;
 *  - `close` — oxirgisi shu filialda «Chiqish», 10 daqiqa ichida;
 *  - `resume` — oxirgisi shu filialda «Kirish» (16 soat ichida) yoki «Chiqish» (10 daqiqa ichida — smenani topshirish
 *    uchun kassa bloklangan bo'lsa ochsin).
 */
export function faceIdAllows(need: FaceIdNeed, last: LastFaceIdEvent | null, branchId: string, now: Date): boolean {
  if (!last || last.branchId !== branchId) return false;
  const age = now.getTime() - last.occurredAt.getTime();
  if (age < 0) return false;
  const recent = age <= FACEID_WINDOW_MS;
  if (need === 'open') return last.status === 'checkIn' && recent;
  if (need === 'close') return last.status === 'checkOut' && recent;
  return last.status === 'checkIn' ? age <= FACEID_PRESENCE_MS : recent;
}

/** Tabel raqami (terminaldagi `employeeNo`, HR'da butun son): `"17"`, `"0017"` → 17; boshqasi — `null`. */
export function parseEmployeeNo(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,9}$/.test(text)) return null;
  const number = Number(text);
  return number > 0 ? number : null;
}

/** Tabel raqami admin "Xodimlar" da: 1 … 999 999 999 (HR va terminal shunday raqam beradi). */
export const isValidEmployeeNo = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 999_999_999;
