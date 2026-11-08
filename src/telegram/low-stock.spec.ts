import { stockText } from '../domain/stock-text';
import { crossedBelowMin } from '../warehouse/stock.service';
import { lowStockAlertText, lowStockLine } from './low-stock';

/** "Kam qoldi" — qachon xabar beriladi va matni (bazasiz). */

describe('kam qoldi', () => {
  it('faqat chegaradan pastga tushgan paytda: avval chegaradan kam emas edi, endi kam', () => {
    expect(crossedBelowMin(1850, 1800, 1800)).toBe(false); // hali chegarada
    expect(crossedBelowMin(1800, 1750, 1800)).toBe(true); // chegaradan tushdi
    expect(crossedBelowMin(1850, 1700, 1800)).toBe(true);
    expect(crossedBelowMin(1750, 1700, 1800)).toBe(false); // allaqachon kam edi — takrorlanmaydi
    expect(crossedBelowMin(1700, 2000, 1800)).toBe(false); // to'ldirildi
    expect(crossedBelowMin(100, -50, 0)).toBe(false); // chegara qo'yilmagan
  });

  it("miqdor odam o'qiydigan ko'rinishda: kg / l / dona, qadoqli — to'liq donalar va ochilgani", () => {
    expect(stockText(2500, 'kg', null)).toBe('2,5 kg');
    expect(stockText(1250, 'l', null)).toBe('1,25 l');
    expect(stockText(1200, 'pcs', null)).toBe('1 200 dona');
    expect(stockText(5950, 'kg', 600)).toBe('9 dona + 550 g');
    expect(stockText(6000, 'kg', 600)).toBe('10 dona');
    expect(stockText(50, 'kg', 600)).toBe('50 g');
    expect(stockText(0, 'kg', 600)).toBe('0 dona');
    expect(stockText(350, 'pcs', 100)).toBe('3 qadoq + 50 dona');
    expect(stockText(-150, 'kg', 600)).toBe('−150 g');
  });

  it('xabar: filial nomi bilan sarlavha, har mahsulot — qoldig\'i va chegarasi; tugagani — "tugadi"', () => {
    expect(
      lowStockAlertText({
        branchId: 'br_1',
        branchName: 'Luchvoy',
        lines: [
          { name: 'Ketchup', qty: 1750, minQty: 1800, unit: 'kg', packSize: 600 },
          { name: 'Mayonez', qty: 0, minQty: 1000, unit: 'kg', packSize: null },
        ],
      }),
    ).toBe(
      [
        '⚠️ Luchvoy filialida kam qolgan mahsulotlar:',
        '  • Ketchup — 2 dona + 550 g (chegara: 3 dona)',
        '  • Mayonez — tugadi (chegara: 1 kg)',
      ].join('\n'),
    );
    expect(lowStockLine({ name: 'Salfetka', qty: 40, minQty: 100, unit: 'pcs', packSize: null })).toBe(
      'Salfetka — 40 dona (chegara: 100 dona)',
    );
  });

  it("markazdagi qoldiq — to'ldirish uchun bormi; markazda ham tugagan — \"yo'q\"", () => {
    const line = { name: 'Ketchup', qty: 1750, minQty: 1800, unit: 'kg', packSize: 600 } as const;
    expect(lowStockLine({ ...line, centralQty: 7200 })).toBe(
      'Ketchup — 2 dona + 550 g (chegara: 3 dona · markazda: 12 dona)',
    );
    expect(lowStockLine({ ...line, centralQty: 0 })).toBe("Ketchup — 2 dona + 550 g (chegara: 3 dona · markazda: yo'q)");
    expect(lowStockLine({ ...line, centralQty: -300 })).toBe("Ketchup — 2 dona + 550 g (chegara: 3 dona · markazda: yo'q)");
  });
});
