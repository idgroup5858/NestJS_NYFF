import { producedUnitPrice, productionCost } from './production';

describe('tayyorlash tannarxi', () => {
  it("go'sht (kg), qadoqli tuxum (30 dona), yog' (l) → jami so'm; katlet narxi — tannarx ÷ dona", () => {
    const cost = productionCost([
      { qty: 48000, unit: 'kg', packSize: null, lastPrice: 90000 }, // 48 kg × 90 000
      { qty: 20, unit: 'pcs', packSize: 30, lastPrice: 45000 }, // 20 dona, 30 talik qadoq 45 000
      { qty: 1000, unit: 'l', packSize: null, lastPrice: 30000 }, // 1 l × 30 000
    ]);
    expect(cost).toBe(4_320_000 + 30_000 + 30_000);
    expect(producedUnitPrice(cost!, 498, 'pcs', null)).toBe(8795); // 4 380 000 / 498 = 8 795,18
  });

  it("birortasining narxi yo'q — tannarx noma'lum (yarim summa emas)", () => {
    expect(
      productionCost([
        { qty: 1000, unit: 'kg', packSize: null, lastPrice: 90000 },
        { qty: 5, unit: 'pcs', packSize: null, lastPrice: null },
      ]),
    ).toBeNull();
  });

  it('tayyor mahsulot qadoqli yoki kg da — narx uning hisob birligiga', () => {
    // 12 000 g qiyma-aralashma 1 200 000 so'm: 1 kg — 100 000, 500 g lik qadoq — 50 000
    expect(producedUnitPrice(1_200_000, 12000, 'kg', null)).toBe(100000);
    expect(producedUnitPrice(1_200_000, 12000, 'kg', 500)).toBe(50000);
  });
});
