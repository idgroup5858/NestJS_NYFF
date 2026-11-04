import { emptyShiftSummary } from '../shifts/shift-summary';
import { som } from './format';
import { shiftReportText, type ShiftReport } from './shift-report';

/** Smena hisoboti matni (bazasiz). Vaqt — mahalliy, test qaysi zonada ishlashidan qat'i nazar. */

const report = (patch: Partial<ShiftReport> = {}): ShiftReport => ({
  branchName: 'Chilonzor',
  cashierName: 'Dilnoza',
  closedByName: null,
  openedAt: new Date(2026, 10, 2, 9, 5),
  closedAt: new Date(2026, 10, 2, 21, 20),
  summary: {
    orderCount: 4,
    cancelledCount: 1,
    total: 1_250_000,
    byPayment: { cash: 700_000, card: 550_000, click: 0 },
  },
  cancelledAmount: 45_000,
  byType: {
    dine_in: { count: 2, amount: 500_000 },
    takeaway: { count: 0, amount: 0 },
    delivery: { count: 2, amount: 750_000 },
  },
  bySource: { cashier: 3, kiosk: 0, mobile: 1 },
  topProducts: [
    { name: 'Klassik burger', qty: 6 },
    { name: 'Kola 0,5 l', qty: 4 },
  ],
  lowStock: [
    { name: 'Ketchup', qty: 1300, minQty: 1800, unit: 'kg', packSize: 600 },
    { name: 'Pishloq', qty: 1500, minQty: 2000, unit: 'kg', packSize: null },
    { name: 'Salfetka', qty: -20, minQty: 500, unit: 'pcs', packSize: 100 },
  ],
  ...patch,
});

describe('smena hisoboti', () => {
  it("so'm — minglar bo'sh joy bilan", () => {
    expect(som(0)).toBe("0 so'm");
    expect(som(999)).toBe("999 so'm");
    expect(som(12_345_000)).toBe("12 345 000 so'm");
  });

  it("to'liq hisobot: vaqtlar, davomiyligi, tushum, turlar, manbalar, bekor qilinganlar, top taomlar, kam qolganlar; nol qatorlar yo'q", () => {
    expect(shiftReportText(report())).toBe(
      [
        'Smena yopildi — Chilonzor',
        'Kassir: Dilnoza',
        'Ochildi: 02.11.2026 09:05',
        'Yopildi: 02.11.2026 21:20 (12 soat 15 daqiqa)',
        '',
        'Buyurtmalar: 4 ta',
        "Tushum: 1 250 000 so'm",
        "  • Naqd: 700 000 so'm",
        "  • Karta: 550 000 so'm",
        "O'rtacha chek: 312 500 so'm",
        "Bekor qilingan: 1 ta — 45 000 so'm",
        '',
        "Turi bo'yicha:",
        "  • Zalda: 2 ta — 500 000 so'm",
        "  • Dostavka: 2 ta — 750 000 so'm",
        '',
        'Qayerdan:',
        '  • Kassa: 3 ta',
        '  • Mobil ilova: 1 ta',
        '',
        "Eng ko'p sotilgan:",
        '  1. Klassik burger — 6 ta',
        '  2. Kola 0,5 l — 4 ta',
        '',
        'Omborda kam qolgan:',
        '  • Ketchup — 2 dona + 100 g (chegara: 3 dona)',
        '  • Pishloq — 1,5 kg (chegara: 2 kg)',
        '  • Salfetka — tugadi (chegara: 5 qadoq)',
      ].join('\n'),
    );
  });

  it("buyurtmasiz smena — faqat sarlavha, vaqtlar va nol; admin yopgani ko'rinadi", () => {
    const empty = report({
      closedByName: 'Admin',
      openedAt: new Date(2026, 10, 1, 23, 50),
      closedAt: new Date(2026, 10, 2, 0, 30),
      summary: emptyShiftSummary(),
      cancelledAmount: 0,
      byType: {
        dine_in: { count: 0, amount: 0 },
        takeaway: { count: 0, amount: 0 },
        delivery: { count: 0, amount: 0 },
      },
      bySource: { cashier: 0, kiosk: 0, mobile: 0 },
      topProducts: [],
      lowStock: [],
    });
    expect(shiftReportText(empty)).toBe(
      [
        'Smena yopildi — Chilonzor',
        'Kassir: Dilnoza',
        'Smenani admin yopdi: Admin',
        'Ochildi: 01.11.2026 23:50',
        'Yopildi: 02.11.2026 00:30 (40 daqiqa)',
        '',
        'Buyurtmalar: 0 ta',
        "Tushum: 0 so'm",
      ].join('\n'),
    );
  });
});
