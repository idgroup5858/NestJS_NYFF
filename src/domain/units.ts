import type { StockUnit } from '../common/enums';

const FACTOR: Record<StockUnit, number> = { kg: 1000, l: 1000, pcs: 1 };

/** 12.5 kg → 12500 g. Asosiy birlik doim butun son. */
export function toBase(qty: number, unit: StockUnit): number {
  return Math.round(qty * FACTOR[unit]);
}

/** 12500 g → 12.5 kg */
export function fromBase(qty: number, unit: StockUnit): number {
  return qty / FACTOR[unit];
}
