import { convertPrice, fromBase, splitPacks, toBase, unitSize } from './units';

describe('birliklar va qadoq', () => {
  it('qadoqsiz — kg / l / dona, qadoq bilan — 1 dona = qadoq hajmi', () => {
    expect(unitSize('kg')).toBe(1000);
    expect(unitSize('pcs')).toBe(1);
    expect(unitSize('kg', 600)).toBe(600);
    expect(unitSize('pcs', 100)).toBe(100);
    expect(toBase(12.5, 'kg')).toBe(12500);
    expect(toBase(10, 'kg', 600)).toBe(6000);
    expect(toBase(0.5, 'l', 750)).toBe(375);
    expect(toBase(3, 'pcs', 100)).toBe(300);
    expect(fromBase(5400, 'kg', 600)).toBe(9);
    expect(fromBase(12500, 'kg', null)).toBe(12.5);
  });

  it("narx birlikdan birlikka: 28 000 / kg → 16 800 / dona (600 g), so'm butun", () => {
    expect(convertPrice(28000, 1000, 600)).toBe(16800);
    expect(convertPrice(16800, 600, 1000)).toBe(28000);
    expect(convertPrice(18000, 600, 500)).toBe(15000);
    expect(convertPrice(10000, 3, 1)).toBe(3333);
  });

  it("qoldiq: to'liq dona + ochilgani (hot-dog 50 g dan)", () => {
    expect(splitPacks(6000, 600)).toEqual({ packs: 10, rest: 0 });
    expect(splitPacks(5950, 600)).toEqual({ packs: 9, rest: 550 });
    expect(splitPacks(5400, 600)).toEqual({ packs: 9, rest: 0 });
    expect(splitPacks(50, 600)).toEqual({ packs: 0, rest: 50 });
    expect(splitPacks(0, 600)).toEqual({ packs: 0, rest: 0 });
    expect(splitPacks(-100, 600)).toEqual({ packs: 0, rest: -100 });
    expect(splitPacks(-700, 600)).toEqual({ packs: -1, rest: -100 });
  });
});
