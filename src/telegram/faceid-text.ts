import type { FaceIdNeed } from '../domain/faceid';
import { dateTime } from './format';

/** FaceID ruxsat so'rovi (Telegram, admin chatlariga) — tizim xabari, adabiy tilda. */
export interface FaceIdRequestInfo {
  branchName: string;
  cashierName: string;
  action: FaceIdNeed;
  createdAt: Date;
}

const ACTION: Record<FaceIdNeed, string> = {
  open: 'smena ochish',
  resume: 'kassaga kirish (smenasi ochiq)',
  close: 'smenani topshirish',
};

/** Tugmalar ma'lumoti: `fid:<so'rov id>:1` — ruxsat, `:0` — rad (Telegram cheki — 64 bayt). */
export const faceIdCallback = (requestId: string, approve: boolean) => `fid:${requestId}:${approve ? 1 : 0}`;

export function parseFaceIdCallback(data: string | undefined): { requestId: string; approve: boolean } | null {
  const match = /^fid:(fid_[0-9a-f]{16}):([01])$/.exec(data ?? '');
  return match ? { requestId: match[1], approve: match[2] === '1' } : null;
}

export function faceIdRequestText(info: FaceIdRequestInfo): string {
  return [
    "FaceID'siz ruxsat so'ralmoqda",
    `Filial: ${info.branchName}`,
    `Kassir: ${info.cashierName}`,
    `Amal: ${ACTION[info.action]}`,
    `Vaqt: ${dateTime(info.createdAt)}`,
    '',
    "Kassir terminaldan o'tolmayapti. Ruxsat berilsa — 10 daqiqa davomida shu filialda FaceID'siz kiradi, smena " +
      'ochadi va topshiradi.',
  ].join('\n');
}

const pad = (value: number) => String(value).padStart(2, '0');
const hhmm = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Qarordan keyin xabar oxiriga (tugmalar olib tashlanadi). */
export function faceIdOutcomeLine(
  outcome: 'approved' | 'rejected' | 'expired',
  adminName: string | null,
  at: Date | null,
): string {
  if (outcome === 'expired') return "Muddati o'tdi — javob berilmadi";
  const who = [adminName, at && hhmm(at)].filter(Boolean).join(', ');
  return `${outcome === 'approved' ? '✅ Ruxsat berildi' : '❌ Rad etildi'}${who ? ` — ${who}` : ''}`;
}
