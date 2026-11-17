import type { RecipeLine } from '../common/types';
import { productionCost, type CostLine } from './production';

/** Retseptdagi ombor mahsuloti: birligi, qadoq hajmi va 1 birlik (qadoqli — 1 dona) oxirgi narxi. */
export type CostIngredient = Pick<CostLine, 'unit' | 'packSize' | 'lastPrice'>;

/**
 * Bitta taomning tannarxi, so'm (butun): retseptdagi har bir mahsulot — miqdor × oxirgi narx ÷ hisob birligi hajmi
 * (tayyorlash tannarxi bilan bir xil hisob, `productionCost`): 150 g qiyma × 100 000 / kg + 1 dona non × 2 000 = 17 000.
 * `null` — retsept bo'sh, mahsulot topilmadi yoki birortasining narxi yo'q (yarim tannarx noto'g'ri bo'lardi).
 */
export function recipeCost(recipe: RecipeLine[], ingredients: Map<string, CostIngredient>): number | null {
  if (recipe.length === 0) return null;
  const lines: CostLine[] = [];
  for (const line of recipe) {
    const ingredient = ingredients.get(line.ingredientId);
    if (!ingredient) return null;
    lines.push({ qty: line.qty, unit: ingredient.unit, packSize: ingredient.packSize, lastPrice: ingredient.lastPrice });
  }
  return productionCost(lines);
}
