import type { StockUnit } from '../common/enums';
import { fromBase, splitPacks, toBase } from './units';

/** Odam o'qiydigan birlik nomlari (AI javobi, Telegram xabarlari) — "pcs" emas, "dona". */
export const UNIT_LABEL: Record<StockUnit, string> = { kg: 'kg', l: 'l', pcs: 'dona' };
export const BASE_LABEL: Record<StockUnit, string> = { kg: 'g', l: 'ml', pcs: 'dona' };

/** Qadoq nomi: ketchup — "dona", dona bilan sanaladigan mahsulot (salfetka) — "qadoq". */
export const packName = (unit: StockUnit) => (unit === 'pcs' ? 'qadoq' : 'dona');

/** 1234.5 → "1 234,5" (kasr — 3 xonagacha). */
export function num(value: number): string {
  const [int, frac] = String(Number(value.toFixed(3))).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${frac ? `,${frac}` : ''}`;
}

/**
 * Asosiy birlikdagi miqdor odam o'qiydigan ko'rinishda (Telegram, AI): 2500 g → "2,5 kg", 40 → "40 dona"; qadoqli —
 * to'liq donalar va ochilgani: 5950 g, 1 dona = 600 g → "9 dona + 550 g", 50 g → "50 g", 6000 g → "10 dona". Manfiy —
 * "−" bilan.
 */
export function stockText(qty: number, unit: StockUnit, packSize: number | null): string {
  if (qty < 0) return `−${stockText(-qty, unit, packSize)}`;
  if (packSize === null) return `${num(fromBase(qty, unit))} ${UNIT_LABEL[unit]}`;
  const { packs, rest } = splitPacks(qty, packSize);
  const parts: string[] = [];
  if (packs > 0 || rest === 0) parts.push(`${num(packs)} ${packName(unit)}`);
  if (rest > 0) parts.push(`${num(rest)} ${BASE_LABEL[unit]}`);
  return parts.join(' + ');
}

/**
 * Kirim / ko'chirish qatoridagi miqdor (ombor birligida, qadoqli — qadoqda) odam o'qiydigan ko'rinishda. Donali qadoqli
 * mahsulot (tuxum, 1 qadoq = 30 dona) — to'liq qadoqlar va qolgan dona (2026-11-18): 50/30 → "1 qadoq + 20 dona", 2 →
 * "2 qadoq"; boshqasi — "12,5 kg", "10 dona" (ketchup 600 g lik).
 */
export function docQtyText(qty: number, unit: StockUnit, packSize: number | null): string {
  if (unit === 'pcs' && packSize !== null) return stockText(toBase(qty, unit, packSize), unit, packSize);
  return `${num(qty)} ${packSize === null ? UNIT_LABEL[unit] : packName(unit)}`;
}
