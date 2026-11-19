import { normOutputPrice, normSplit, rawQty, type YieldNorm } from './yield-norm';

/** Foydalanuvchi o'lchagan namuna (2026-11-19): 20 ta tovuq, 64 kg → 34,5 kg yarim tayyor go'sht + 5 kg qanot (24,5 kg suyak). */
const chicken: YieldNorm = {
  qty: 64,
  outputs: [
    { ingredientId: 'meat', qty: 34.5 },
    { ingredientId: 'wings', qty: 5 },
  ],
};
const kg = () => 'kg' as const;

describe("norma (butun tovuq → go'sht + qanot)", () => {
  it("kirimdagi miqdor namuna nisbatida bo'linadi, har biri butun grammga", () => {
    expect(normSplit(64000, chicken, 'kg', kg)).toEqual([
      { ingredientId: 'meat', qty: 34500 },
      { ingredientId: 'wings', qty: 5000 },
    ]);
    // 70 kg: 37 734,375 g va 5 468,75 g
    expect(normSplit(70000, chicken, 'kg', kg)).toEqual([
      { ingredientId: 'meat', qty: 37734 },
      { ingredientId: 'wings', qty: 5469 },
    ]);
  });

  it("narx chiqqanlarga og'irligi bo'yicha teng: 30 000 × 64 ÷ 39,5 = 48 608 so'm / kg", () => {
    expect(normOutputPrice(30000, 1000, chicken, 'kg', kg, 1000)).toBe(48608);
    // chiqqan mahsulot 500 g lik qadoqda — 1 qadoq narxi
    expect(normOutputPrice(30000, 1000, chicken, 'kg', kg, 500)).toBe(24304);
    // tovuq donada (1 dona = 3,2 kg) 96 000 so'mdan — 1 kg ga o'sha narx
    expect(normOutputPrice(96000, 3200, chicken, 'kg', kg, 1000)).toBe(48608);
  });
});

describe('pishganda chiqishi (1000 g → 655 g)', () => {
  it("retseptdagi pishgan miqdor → xom: 100 g → 153 g; pishish yozilmagan — o'zi", () => {
    expect(rawQty(100, 655)).toBe(153);
    expect(rawQty(150, 655)).toBe(229);
    expect(rawQty(100, null)).toBe(100);
    expect(rawQty(100, undefined)).toBe(100);
    // guruch kabi og'irlashadigan: 1000 g → 2500 g
    expect(rawQty(250, 2500)).toBe(100);
    // 0 ga yaxlitlanmaydi
    expect(rawQty(1, 10000)).toBe(1);
  });
});
