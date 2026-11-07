import type { StockUnit } from '../common/enums';
import { fromBase, splitPacks } from './units';

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
