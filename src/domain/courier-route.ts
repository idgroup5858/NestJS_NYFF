import type { LatLng } from '../common/types';
import { distanceKm } from './geo';

/**
 * Kuryer bir nechta buyurtmani olganda — qaysi manzilga birinchi borish. Kelishilgan mezon (2026-10-27): **mijozlar
 * o'rtacha eng kam kutadi** — har bir mijozga yetib borish masofalari yig'indisi eng kichik bo'lgan tartib. Masofa —
 * to'g'ri chiziq bo'yicha (bepul; keyin haqiqiy yo'lga — masalan OSRM — almashtirish mumkin, faqat [distance] o'zgaradi).
 *
 * Har bir yo'l bo'lagi undan keyin hali kutayotgan mijozlar soniga ko'paytiriladi: 1-bo'lak hamma n mijozni kuttiradi,
 * 2-si n−1 tasini va h.k. 12 tagacha manzil — aniq yechim (to'plamlar bo'yicha dinamik dasturlash), ko'prog'ida — eng
 * yaqini birinchi.
 */

export interface RouteStop {
  id: string;
  point: LatLng;
}

export interface PlannedStop {
  id: string;
  /** oldingi nuqtadan (boshlanish yoki oldingi manzil) shu manzilgacha, km */
  legKm: number;
}

const EXACT_LIMIT = 12;

export function planRoute(
  start: LatLng | null,
  stops: RouteStop[],
  distance: (a: LatLng, b: LatLng) => number = distanceKm,
): PlannedStop[] {
  const n = stops.length;
  if (n === 0) return [];
  // boshlanish nuqtasi noma'lum (filial xaritada belgilanmagan) — birinchi bo'lak hisobga olinmaydi
  const fromStart = (j: number) => (start ? distance(start, stops[j].point) : 0);
  const between = stops.map((a) => stops.map((b) => distance(a.point, b.point)));
  const order = n <= EXACT_LIMIT ? exactOrder(n, fromStart, between) : nearestFirst(n, fromStart, between);
  return order.map((j, k) => ({
    id: stops[j].id,
    legKm: k === 0 ? fromStart(j) : between[order[k - 1]][j],
  }));
}

/** Yangi manzil kuryer yo'liga qo'shilsa yo'l qancha uzayadi (eng arzon joyga qo'yib), km. */
export function insertionKm(
  start: LatLng | null,
  route: LatLng[],
  point: LatLng,
  distance: (a: LatLng, b: LatLng) => number = distanceKm,
): number {
  const points = start ? [start, ...route] : route;
  if (points.length === 0) return 0;
  let best = distance(points[points.length - 1], point);
  for (let i = 0; i < points.length - 1; i++) {
    const extra = distance(points[i], point) + distance(point, points[i + 1]) - distance(points[i], points[i + 1]);
    if (extra < best) best = extra;
  }
  // boshlanishsiz yo'lda yangi manzil eng boshiga ham qo'yilishi mumkin
  if (!start && route.length > 0) best = Math.min(best, distance(point, route[0]));
  return Math.max(0, best);
}

/**
 * Teng tartiblardan (masalan bir uydagi ikki buyurtma) — ro'yxatdagi tartibi oldingisi birinchi: kichik indeksni
 * kechroq qo'yish juda oz (santimetrlar) qimmatroq.
 */
const tie = (j: number, remaining: number) => j * remaining * 1e-7;

/** dp[mask][j] — [mask] dagi manzillar yetkazilib, oxirgisi j bo'lgandagi eng kichik kutish yig'indisi. */
function exactOrder(n: number, fromStart: (j: number) => number, between: number[][]): number[] {
  const size = 1 << n;
  const dp: number[][] = Array.from({ length: size }, () => new Array<number>(n).fill(Infinity));
  const prev: number[][] = Array.from({ length: size }, () => new Array<number>(n).fill(-1));
  for (let j = 0; j < n; j++) dp[1 << j][j] = fromStart(j) * n + tie(j, n);
  for (let mask = 1; mask < size; mask++) {
    const remaining = n - popcount(mask);
    if (remaining === 0) continue;
    for (let last = 0; last < n; last++) {
      const cost = dp[mask][last];
      if (cost === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const value = cost + between[last][next] * remaining + tie(next, remaining);
        if (value < dp[nextMask][next]) {
          dp[nextMask][next] = value;
          prev[nextMask][next] = last;
        }
      }
    }
  }
  const full = size - 1;
  let last = 0;
  for (let j = 1; j < n; j++) if (dp[full][j] < dp[full][last]) last = j;
  const order: number[] = [];
  for (let mask = full; last !== -1; ) {
    order.push(last);
    const before = prev[mask][last];
    mask &= ~(1 << last);
    last = before;
  }
  return order.reverse();
}

function nearestFirst(n: number, fromStart: (j: number) => number, between: number[][]): number[] {
  const left = new Set(Array.from({ length: n }, (_, j) => j));
  const order: number[] = [];
  let current = -1;
  while (left.size > 0) {
    let best = -1;
    for (const j of left) {
      const d = current === -1 ? fromStart(j) : between[current][j];
      const bestD = best === -1 ? Infinity : current === -1 ? fromStart(best) : between[current][best];
      if (d < bestD) best = j;
    }
    order.push(best);
    left.delete(best);
    current = best;
  }
  return order;
}

function popcount(mask: number): number {
  let count = 0;
  for (let m = mask; m; m &= m - 1) count++;
  return count;
}
