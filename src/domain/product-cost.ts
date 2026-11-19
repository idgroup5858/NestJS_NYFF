import type { RecipeLine } from '../common/types';
import { productionCost, type CostLine } from './production';
import { rawQty } from './yield-norm';

/**
 * Retseptdagi ombor mahsuloti: birligi, qadoq hajmi, 1 birlik (qadoqli — 1 dona) oxirgi narxi va pishganda chiqishi
 * (1000 g dan necha g; yo'q — `null`).
 */
export type CostIngredient = Pick<CostLine, 'unit' | 'packSize' | 'lastPrice'> & { cookYield?: number | null };

/**
 * Bitta taomning tannarxi, so'm (butun): retseptdagi har bir mahsulot — miqdor × oxirgi narx ÷ hisob birligi hajmi
 * (tayyorlash tannarxi bilan bir xil hisob, `productionCost`): 150 g qiyma × 100 000 / kg + 1 dona non × 2 000 = 17 000.
 * "Pishganda chiqishi" yozilgan mahsulot — sotuvda ayriladigan xom miqdori bilan (100 g pishgan go'sht = 153 g).
 * `null` — retsept bo'sh, mahsulot topilmadi yoki birortasining narxi yo'q (yarim tannarx noto'g'ri bo'lardi).
 */
export function recipeCost(recipe: RecipeLine[], ingredients: Map<string, CostIngredient>): number | null {
  if (recipe.length === 0) return null;
  const lines: CostLine[] = [];
  for (const line of recipe) {
    const ingredient = ingredients.get(line.ingredientId);
    if (!ingredient) return null;
    lines.push({
      qty: rawQty(line.qty, ingredient.cookYield),
      unit: ingredient.unit,
      packSize: ingredient.packSize,
      lastPrice: ingredient.lastPrice,
    });
  }
  return productionCost(lines);
}
