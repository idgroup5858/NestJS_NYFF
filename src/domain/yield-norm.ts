import type { StockUnit } from '../common/enums';
import { toBase } from './units';

/** Normadagi bitta chiqish: [qty] — namunadan chiqqani, chiqqan mahsulotning ombor birligida, qadoqsiz (kg / l / dona). */
export interface YieldOutput {
  ingredientId: string;
  qty: number;
}

/**
 * Norma (2026-11-19) — bir marta o'lchangan namuna: [qty] butun mahsulotdan (ombor birligida, qadoqsiz) [outputs]
 * chiqadi, qolgani chiqindi. 64 kg tovuq → 34,5 kg yarim tayyor go'sht + 5 kg qanot (24,5 kg suyak). Kirimda butun
 * mahsulot o'zi emas, shu nisbatda chiqqanlari omborga qo'shiladi.
 */
export interface YieldNorm {
  qty: number;
  outputs: YieldOutput[];
}

/** Pishganda chiqishi shuncha asosiy birlikdan o'lchanadi: 1000 g xom → 655 g pishgan. */
export const COOK_YIELD_BASE = 1000;

/**
 * Kirimdagi miqdor (asosiy birlikda) normaga ko'ra bo'linadi — har chiqish o'z asosiy birligida, butun songa
 * yaxlitlanadi: 70 kg tovuq, namuna 64 kg → 34,5 kg go'sht + 5 kg qanot ⇒ 37 734 g go'sht + 5 469 g qanot.
 * [unitOf] — chiqqan mahsulotning ombor birligi.
 */
export function normSplit(
  baseQty: number,
  norm: YieldNorm,
  inputUnit: StockUnit,
  unitOf: (ingredientId: string) => StockUnit,
): YieldOutput[] {
  const sample = toBase(norm.qty, inputUnit);
  return norm.outputs.map((output) => ({
    ingredientId: output.ingredientId,
    qty: Math.round((baseQty * toBase(output.qty, unitOf(output.ingredientId))) / sample),
  }));
}

/**
 * Chiqqan mahsulotning 1 birlik narxi, so'm (butun): kirim summasi chiqqanlarga **og'irligi bo'yicha teng** bo'linadi
 * (chiqindi narxi ham ularga tushadi). 30 000 so'm / kg tovuq, 64 kg dan 34,5 + 5 = 39,5 kg chiqadi → 1 kg go'sht ham,
 * qanot ham 30 000 × 64 ÷ 39,5 = 48 608 so'm. [price] — kirim qatoridagi 1 birlik narxi, [lineSize] — o'sha birlikning
 * hajmi asosiy birlikda (1 kg = 1000); [outputSize] — chiqqan mahsulot hisob birligining hajmi (qadoqli — 1 dona).
 * Normadagi chiqishlar butun mahsulot bilan bir o'lchamda (kg / l yoki dona) — saqlashda tekshiriladi.
 */
export function normOutputPrice(
  price: number,
  lineSize: number,
  norm: YieldNorm,
  inputUnit: StockUnit,
  unitOf: (ingredientId: string) => StockUnit,
  outputSize: number,
): number {
  const sample = toBase(norm.qty, inputUnit);
  const out = norm.outputs.reduce((sum, output) => sum + toBase(output.qty, unitOf(output.ingredientId)), 0);
  return Math.round((price * sample * outputSize) / (lineSize * out));
}

/**
 * Retseptdagi **pishgan** miqdor → ombordan ayriladigan xom miqdor, asosiy birlikda (butun, kamida 1): mahsulotda
 * "pishganda 1000 g → 655 g" bo'lsa shaurmadagi 100 g pishgan go'sht = 153 g yarim tayyor. [cookYield] `null` —
 * retseptdagi son o'zi.
 */
export function rawQty(qty: number, cookYield: number | null | undefined): number {
  if (cookYield == null) return qty;
  return Math.max(1, Math.round((qty * COOK_YIELD_BASE) / cookYield));
}
