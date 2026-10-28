import type { LatLng } from '../common/types';
import { insertionKm, planRoute, type RouteStop } from './courier-route';
import { distanceKm } from './geo';

/** Sinov uchun to'g'ri chiziq: nuqta — `lat` (km), masofa — farqi. */
const line = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat);
const at = (km: number): LatLng => ({ lat: km, lng: 0 });
const stop = (id: string, km: number): RouteStop => ({ id, point: at(km) });

/** Mijozlar kutishi yig'indisi (har biriga yetib borguncha bosib o'tilgan yo'l). */
function waiting(start: LatLng, stops: RouteStop[], ids: string[], distance = line): number {
  let position = start;
  let travelled = 0;
  let sum = 0;
  for (const id of ids) {
    const next = stops.find((s) => s.id === id)!.point;
    travelled += distance(position, next);
    sum += travelled;
    position = next;
  }
  return sum;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe('planRoute — mijozlar o\'rtacha eng kam kutadigan tartib', () => {
  it("bo'sh va bitta manzil", () => {
    expect(planRoute(at(0), [], line)).toEqual([]);
    expect(planRoute(at(0), [stop('a', 3)], line)).toEqual([{ id: 'a', legKm: 3 }]);
  });

  it("bir yo'nalishda — yaqinidan uzog'iga, bo'laklar oldingi nuqtadan", () => {
    const plan = planRoute(at(0), [stop('c', 3), stop('a', 1), stop('b', 2)], line);
    expect(plan).toEqual([
      { id: 'a', legKm: 1 },
      { id: 'b', legKm: 1 },
      { id: 'c', legKm: 1 },
    ]);
  });

  it("eng qisqa yo'l emas — ko'p mijoz kutayotgan tomon birinchi", () => {
    // filial 0 da; A — 2 km o'ngda (1 mijoz), B1 va B2 — 3 km chapda (2 mijoz, bir joyda)
    const stops = [stop('A', 2), stop('B1', -3), stop('B2', -3)];
    // eng qisqa yo'l A dan boshlanardi (2 + 5 = 7 km, B dan — 3 + 5 = 8 km), lekin unda ikki mijoz 7 km kutadi
    expect(waiting(at(0), stops, ['A', 'B1', 'B2'])).toBe(16);
    expect(waiting(at(0), stops, ['B1', 'B2', 'A'])).toBe(14);
    expect(planRoute(at(0), stops, line).map((s) => s.id)).toEqual(['B1', 'B2', 'A']);
  });

  it("aniq yechim — barcha tartiblarni sanab chiqish bilan bir xil natija (tasodifiy shahar nuqtalari)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 30; round++) {
      const n = 1 + Math.floor(rand() * 6);
      const point = () => ({ lat: 41.2 + rand() * 0.2, lng: 69.1 + rand() * 0.3 });
      const start = point();
      const stops = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, point: point() }));
      const plan = planRoute(start, stops);
      const best = Math.min(...permutations(stops.map((s) => s.id)).map((ids) => waiting(start, stops, ids, distanceKm)));
      // teng tartiblarni ajratuvchi tuzatish — santimetrlar
      expect(waiting(start, stops, plan.map((s) => s.id), distanceKm)).toBeCloseTo(best, 4);
      expect(new Set(plan.map((s) => s.id)).size).toBe(n);
    }
  });

  it("12 tadan ko'p manzil — eng yaqini birinchi, hammasi bir martadan", () => {
    const stops = Array.from({ length: 15 }, (_, i) => stop(`s${i}`, (i * 7) % 15));
    const plan = planRoute(at(0), stops, line);
    expect(plan).toHaveLength(15);
    expect(new Set(plan.map((s) => s.id)).size).toBe(15);
    expect(plan[0]).toEqual({ id: 's0', legKm: 0 });
  });

  it("boshlanish noma'lum (filial xaritada yo'q) — birinchi bo'lak 0", () => {
    const plan = planRoute(null, [stop('a', 5), stop('b', 6)], line);
    expect(plan[0].legKm).toBe(0);
    expect(plan.reduce((sum, s) => sum + s.legKm, 0)).toBe(1);
  });
});

describe("insertionKm — yangi manzil yo'lni qancha uzaytiradi", () => {
  it("yo'l ustida — 0, yo'l oxiridan keyin — qo'shimcha masofa", () => {
    expect(insertionKm(at(0), [at(2), at(5)], at(3), line)).toBe(0);
    expect(insertionKm(at(0), [at(2), at(5)], at(8), line)).toBe(3);
    // orqaga burilish: 0 → -1 → 2 → 5 (2 km qo'shimcha)
    expect(insertionKm(at(0), [at(2), at(5)], at(-1), line)).toBe(2);
  });

  it("qo'lda buyurtma yo'q — filialdan masofasi", () => {
    expect(insertionKm(at(0), [], at(4), line)).toBe(4);
  });
});
