import { HttpException } from '@nestjs/common';
import { branchOnlineState, routeDelivery, type RoutableBranch } from './delivery';
import { distanceKm, pointInPolygon } from './geo';
import { orderPayments, resolvePayment } from './payments';
import { isValidWorkHours, isWithinWorkHours } from './work-hours';

/** Frontend `scripts/logic-smoke.ts` dagi toza funksiyalar holatlari (bazasiz). */

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return ((error as HttpException).getResponse() as { code?: string }).code;
  }
  return undefined;
};

const at = (hh: number, mm: number) => new Date(2026, 9, 23, hh, mm);

describe('geometriya', () => {
  const square = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 2 },
    { lat: 2, lng: 2 },
    { lat: 2, lng: 0 },
  ];

  it('nuqta poligon ichida / tashqarisida; 2 ta nuqta — hudud emas', () => {
    expect(pointInPolygon({ lat: 1, lng: 1 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 3, lng: 1 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 1, lng: 1 }, square.slice(0, 2))).toBe(false);
  });

  it('masofa (haversine)', () => {
    expect(Math.abs(distanceKm({ lat: 41.3111, lng: 69.2797 }, { lat: 41.3465, lng: 69.286 }) - 3.97)).toBeLessThan(0.05);
  });
});

describe('ish vaqti', () => {
  it('belgilanmagan — 24/7', () => {
    expect(isWithinWorkHours(null, at(3, 0))).toBe(true);
  });

  it('kunduzgi: ochilish kiradi, yopilish kirmaydi', () => {
    const hours = { open: '10:00', close: '23:00' };
    expect(isWithinWorkHours(hours, at(9, 59))).toBe(false);
    expect(isWithinWorkHours(hours, at(10, 0))).toBe(true);
    expect(isWithinWorkHours(hours, at(22, 59))).toBe(true);
    expect(isWithinWorkHours(hours, at(23, 0))).toBe(false);
  });

  it('yarim tundan o\'tadigan: 18:00–03:00', () => {
    const hours = { open: '18:00', close: '03:00' };
    expect(isWithinWorkHours(hours, at(17, 59))).toBe(false);
    expect(isWithinWorkHours(hours, at(18, 0))).toBe(true);
    expect(isWithinWorkHours(hours, at(0, 30))).toBe(true);
    expect(isWithinWorkHours(hours, at(2, 59))).toBe(true);
    expect(isWithinWorkHours(hours, at(3, 0))).toBe(false);
  });

  it("noto'g'ri qiymatlar", () => {
    expect(isValidWorkHours({ open: '10:00', close: '10:00' })).toBe(false);
    expect(isValidWorkHours({ open: '24:00', close: '10:00' })).toBe(false);
    expect(isValidWorkHours({ open: '9:00', close: '18:00' })).toBe(false);
    expect(isValidWorkHours({ open: '09:00', close: '18:00' })).toBe(true);
  });
});

describe('filial holati va yetkazib berish', () => {
  const pts = (...points: [number, number][]) => points.map(([lat, lng]) => ({ lat, lng }));
  // demo filiallar (frontend seed.ts dagi hududlar)
  const chilonzor: RoutableBranch = {
    id: 'br_chilonzor',
    active: true,
    onlineEnabled: true,
    workHours: null,
    location: { lat: 41.282, lng: 69.2045 },
    deliveryZone: pts([41.305, 69.17], [41.306, 69.215], [41.295, 69.24], [41.272, 69.245], [41.252, 69.233], [41.243, 69.205], [41.248, 69.172], [41.27, 69.155], [41.29, 69.156]),
    deliveryFee: 10_000,
    fallbackBranchId: 'br_yunusobod',
  };
  const yunusobod: RoutableBranch = {
    id: 'br_yunusobod',
    active: true,
    onlineEnabled: true,
    workHours: null,
    location: { lat: 41.3465, lng: 69.286 },
    deliveryZone: pts([41.395, 69.26], [41.398, 69.295], [41.385, 69.325], [41.36, 69.332], [41.338, 69.315], [41.33, 69.285], [41.338, 69.255], [41.365, 69.245]),
    deliveryFee: 12_000,
    fallbackBranchId: 'br_chilonzor',
  };
  const branches = [chilonzor, yunusobod];
  const inChilonzor = { lat: 41.28, lng: 69.2 };
  const inYunusobod = { lat: 41.36, lng: 69.29 };
  const center = { lat: 41.3111, lng: 69.2797 };
  const openIds = (...ids: string[]) => (b: RoutableBranch) => ids.includes(b.id);

  it('holat tartibi: faol emas → to\'xtatilgan → ish vaqtidan tashqari → smena → kassa → ochiq', () => {
    const facts = { hasOpenShift: true, kassaOnline: true };
    expect(branchOnlineState(chilonzor, facts, at(12, 0))).toBe('open');
    expect(branchOnlineState({ ...chilonzor, active: false, onlineEnabled: false }, facts, at(12, 0))).toBe('inactive');
    expect(branchOnlineState({ ...chilonzor, onlineEnabled: false }, facts, at(12, 0))).toBe('paused');
    const hours = { open: '10:00', close: '23:00' };
    expect(branchOnlineState({ ...chilonzor, workHours: hours }, facts, at(9, 0))).toBe('off_hours');
    expect(branchOnlineState(chilonzor, { hasOpenShift: false, kassaOnline: true }, at(12, 0))).toBe('no_shift');
    expect(branchOnlineState(chilonzor, { hasOpenShift: true, kassaOnline: false }, at(12, 0))).toBe('no_kassa');
  });

  it('hudud ichida — o\'sha filial, hudud narxi bilan', () => {
    const open = openIds('br_chilonzor', 'br_yunusobod');
    expect(routeDelivery(branches, open, inChilonzor)).toEqual({ branchId: 'br_chilonzor', zoneBranchId: 'br_chilonzor', fee: 10_000, redirected: false });
    expect(routeDelivery(branches, open, inYunusobod)).toEqual({ branchId: 'br_yunusobod', zoneBranchId: 'br_yunusobod', fee: 12_000, redirected: false });
  });

  it('hududdan tashqarida — eng yaqin ochiq filial, narxni kuryer aytadi', () => {
    expect(routeDelivery(branches, openIds('br_chilonzor', 'br_yunusobod'), center)).toEqual({ branchId: 'br_yunusobod', zoneBranchId: null, fee: null, redirected: false });
  });

  it('hudud egasi yopiq — zaxira filial, narx — hudud narxi; hech kim ochiq emas — null', () => {
    expect(routeDelivery(branches, openIds('br_yunusobod'), inChilonzor)).toEqual({ branchId: 'br_yunusobod', zoneBranchId: 'br_chilonzor', fee: 10_000, redirected: true });
    expect(routeDelivery(branches, openIds(), inChilonzor).branchId).toBeNull();
    expect(routeDelivery(branches, openIds(), center).branchId).toBeNull();
  });

  it('faol bo\'lmagan filialning hududi hisobga olinmaydi', () => {
    const route = routeDelivery([{ ...chilonzor, active: false }, yunusobod], openIds('br_yunusobod'), inChilonzor);
    expect(route).toEqual({ branchId: 'br_yunusobod', zoneBranchId: null, fee: null, redirected: false });
  });
});

describe("to'lov", () => {
  it('aralash: asosiy tur — eng katta qism, yig\'indisi = summa', () => {
    const paid = resolvePayment('cash', { cash: 14_000, card: 20_000 }, 34_000);
    expect(paid).toEqual({ payment: 'card', split: { cash: 14_000, card: 20_000 } });
    expect(orderPayments({ ...paid, total: 34_000 })).toEqual({ cash: 14_000, card: 20_000, click: 0 });
  });

  it("noto'g'ri aralash to'lov — invalid_amount", () => {
    expect(codeOf(() => resolvePayment('cash', { cash: 10_000, card: 20_000 }, 34_000))).toBe('invalid_amount');
    expect(codeOf(() => resolvePayment('cash', { cash: 34_000 }, 34_000))).toBe('invalid_amount');
    expect(codeOf(() => resolvePayment('cash', { cash: 4_000.5, card: 30_000 }, 34_000.5))).toBe('invalid_amount');
  });

  it('oddiy to\'lov — butun summa bitta turga', () => {
    expect(orderPayments({ payment: 'click', split: null, total: 9_000 })).toEqual({ cash: 0, card: 0, click: 9_000 });
  });
});
