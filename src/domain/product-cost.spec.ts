import { recipeCost, type CostIngredient } from './product-cost';

const ingredients = new Map<string, CostIngredient>([
  ['cola', { unit: 'pcs', packSize: null, lastPrice: 12000 }],
  ['mince', { unit: 'kg', packSize: null, lastPrice: 100000 }],
  ['bun', { unit: 'pcs', packSize: null, lastPrice: 2000 }],
  ['ketchup', { unit: 'kg', packSize: 600, lastPrice: 18000 }], // 600 g lik qadoq — 18 000
  ['sauce', { unit: 'kg', packSize: null, lastPrice: null }],
]);

describe('taom tannarxi (retsept × oxirgi narx)', () => {
  it("tayyor ichimlik: 1 dona kola — kirim narxi", () => {
    expect(recipeCost([{ ingredientId: 'cola', qty: 1 }], ingredients)).toBe(12000);
  });

  it("burger: 150 g qiyma (kg narxida), 1 non, 50 g ketchup (600 g lik qadoq narxida)", () => {
    expect(
      recipeCost(
        [
          { ingredientId: 'mince', qty: 150 },
          { ingredientId: 'bun', qty: 1 },
          { ingredientId: 'ketchup', qty: 50 },
        ],
        ingredients,
      ),
    ).toBe(15000 + 2000 + 1500);
  });

  it("shaurma: retseptda 100 g pishgan go'sht (1000 g → 655 g) — tannarx 153 g yarim tayyordan", () => {
    const withCooked = new Map(ingredients).set('meat', { unit: 'kg', packSize: null, lastPrice: 48608, cookYield: 655 });
    // 153 × 48 608 / 1000 = 7 437,02
    expect(recipeCost([{ ingredientId: 'meat', qty: 100 }], withCooked)).toBe(7437);
  });

  it("narxi yo'q mahsulot, topilmagan mahsulot yoki bo'sh retsept — noma'lum", () => {
    expect(recipeCost([{ ingredientId: 'bun', qty: 1 }, { ingredientId: 'sauce', qty: 30 }], ingredients)).toBeNull();
    expect(recipeCost([{ ingredientId: 'missing', qty: 1 }], ingredients)).toBeNull();
    expect(recipeCost([], ingredients)).toBeNull();
  });
});
