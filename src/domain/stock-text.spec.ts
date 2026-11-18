import { docQtyText, stockText } from './stock-text';
import { toBase } from './units';

describe('miqdor matni (Telegram, AI)', () => {
  it('qoldiq: to\'liq qadoq + ochilgani', () => {
    expect(stockText(5950, 'kg', 600)).toBe('9 dona + 550 g');
    expect(stockText(50, 'pcs', 30)).toBe('1 qadoq + 20 dona');
    expect(stockText(2500, 'kg', null)).toBe('2,5 kg');
  });

  it('hujjat qatori: donali qadoq (tuxum, 30 talik) — qadoq + dona, boshqasi — son va birlik', () => {
    expect(docQtyText((1 * 30 + 20) / 30, 'pcs', 30)).toBe('1 qadoq + 20 dona');
    expect(docQtyText(50 / 30, 'pcs', 30)).toBe('1 qadoq + 20 dona');
    expect(docQtyText(20 / 30, 'pcs', 30)).toBe('20 dona');
    expect(docQtyText(2, 'pcs', 30)).toBe('2 qadoq');
    // ketchup (600 g lik) — avvalgidek donada, kasr ham
    expect(docQtyText(10, 'kg', 600)).toBe('10 dona');
    expect(docQtyText(1.5, 'kg', 600)).toBe('1,5 dona');
    expect(docQtyText(12.5, 'kg', null)).toBe('12,5 kg');
    expect(docQtyText(40, 'pcs', null)).toBe('40 dona');
  });

  it("kasr qadoq qoldiqqa aniq dona bo'lib tushadi (1…3000 dona, qadoq 1…100)", () => {
    const wrong: string[] = [];
    for (let pack = 1; pack <= 100; pack += 1) {
      for (let pieces = 1; pieces <= 3000; pieces += 1) {
        if (toBase(pieces / pack, 'pcs', pack) !== pieces) wrong.push(`${pieces}/${pack}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
