import type { LatLng, WorkHours } from '../common/types';
import { distanceKm, pointInPolygon } from './geo';
import { isWithinWorkHours } from './work-hours';

/**
 * Online buyurtma: filial ochiqmi va dostavka qaysi filialga tushadi. Frontend `src/domain/logic/delivery.ts` mantiqi +
 * ROADMAP 2-bo'limda kelishilgan qo'shimcha shartlar (kassa ekrani ulangan, ish vaqti).
 */

/**
 * open — qabul qiladi; inactive — filial faol emas; paused — admin to'xtatgan; off_hours — ish vaqtidan tashqari;
 * no_shift — ochiq smena yo'q; no_kassa — smena ochiq, lekin hech bir kassa ekrani ulanmagan.
 */
export type BranchOnlineState = 'open' | 'inactive' | 'paused' | 'off_hours' | 'no_shift' | 'no_kassa';

export interface RoutableBranch {
  id: string;
  active: boolean;
  onlineEnabled: boolean;
  workHours: WorkHours | null;
  location: LatLng | null;
  deliveryZone: LatLng[];
  deliveryFee: number;
  fallbackBranchId: string | null;
}

/** Bazadan va socket'dan olinadigan holat: smena ochiqmi, kassa ekrani ulanganmi. */
export interface BranchFacts {
  hasOpenShift: boolean;
  kassaOnline: boolean;
}

export function branchOnlineState(branch: RoutableBranch, facts: BranchFacts, now: Date): BranchOnlineState {
  if (!branch.active) return 'inactive';
  if (!branch.onlineEnabled) return 'paused';
  if (!isWithinWorkHours(branch.workHours, now)) return 'off_hours';
  if (!facts.hasOpenShift) return 'no_shift';
  if (!facts.kassaOnline) return 'no_kassa';
  return 'open';
}

export const hasZone = (branch: RoutableBranch): boolean => branch.deliveryZone.length >= 3;

export interface DeliveryRoute {
  /** buyurtmani oladigan filial; `null` — hech bir filial ochiq emas (buyurtma qabul qilinmaydi) */
  branchId: string | null;
  /** nuqta tushgan hudud egasi; `null` — hech bir hududga tushmadi */
  zoneBranchId: string | null;
  /** yetkazish narxi (hudud narxi); `null` — hududdan tashqarida, narxni kuryer aytadi (tizimga yozilmaydi) */
  fee: number | null;
  /** hudud egasi yopiq — buyurtma zaxira (yoki eng yaqin ochiq) filialga yo'naltirildi */
  redirected: boolean;
}

/**
 * Yetkazib berish manzili bo'yicha filial:
 *  1. nuqta ochiq filial hududida — o'sha filial, hudud narxi bilan (hududlar ustma-ust tushsa — eng yaqini);
 *  2. hudud egasi yopiq — uning zaxira filiali, u ham yopiq bo'lsa eng yaqin ochiq filial; narx — hudud narxi;
 *  3. hech bir hududda emas — eng yaqin ochiq filial, narxni kuryer aytadi.
 * Faol bo'lmagan filialning hududi hisobga olinmaydi. Joyi belgilanmagan filial "eng yaqin" ro'yxatining oxirida.
 */
export function routeDelivery(
  branches: RoutableBranch[],
  isOpen: (branch: RoutableBranch) => boolean,
  point: LatLng,
): DeliveryRoute {
  const distance = (branch: RoutableBranch) => (branch.location ? distanceKm(point, branch.location) : Infinity);
  const active = branches.filter((b) => b.active).sort((a, b) => distance(a) - distance(b));
  const nearestOpen = active.find(isOpen) ?? null;
  const zones = active.filter((b) => hasZone(b) && pointInPolygon(point, b.deliveryZone));

  if (zones.length === 0) {
    return { branchId: nearestOpen?.id ?? null, zoneBranchId: null, fee: null, redirected: false };
  }

  const direct = zones.find(isOpen);
  if (direct) return { branchId: direct.id, zoneBranchId: direct.id, fee: direct.deliveryFee, redirected: false };

  const home = zones[0];
  const fallback = branches.find((b) => b.id === home.fallbackBranchId);
  const target = fallback && isOpen(fallback) ? fallback : nearestOpen;
  return { branchId: target?.id ?? null, zoneBranchId: home.id, fee: home.deliveryFee, redirected: true };
}
