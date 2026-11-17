import type { StockUnit } from '../common/enums';
import { unitSize } from './units';

/** Tayyorlashda sarflangan mahsulot: miqdor asosiy birlikda (g / ml / dona) va uning 1 birlik narxi. */
export interface CostLine {
  /** asosiy birlikda */
  qty: number;
  unit: StockUnit;
  packSize: number | null;
  /** 1 birlik (qadoqli — 1 dona) narxi, so'm; `null` — narxi yozilmagan */
  lastPrice: number | null;
}

/**
 * Sarflanganlar tannarxi, so'm (butun): har biri — miqdor × narx ÷ hisob birligi hajmi (48 kg go'sht × 90 000 / kg,
 * 20 dona tuxum × 45 000 / 30 talik qadoq). Birortasining narxi bo'lmasa — `null` (yarim tannarx noto'g'ri bo'lardi).
 */
export function productionCost(lines: CostLine[]): number | null {
  let total = 0;
  for (const line of lines) {
    if (line.lastPrice === null) return null;
    total += (line.qty * line.lastPrice) / unitSize(line.unit, line.packSize);
  }
  return Math.round(total);
}

/**
 * Tayyor mahsulotning 1 birlik (qadoqli — 1 dona) narxi, so'm: tannarx ÷ chiqqan miqdor. [baseQty] — asosiy birlikda,
 * > 0. 4 380 000 so'm, 498 dona katlet → 8 795 / dona.
 */
export function producedUnitPrice(cost: number, baseQty: number, unit: StockUnit, packSize: number | null): number {
  return Math.round((cost * unitSize(unit, packSize)) / baseQty);
}
