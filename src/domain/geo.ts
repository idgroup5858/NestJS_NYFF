import type { LatLng } from '../common/types';

/**
 * Xarita geometriyasi — frontend `src/domain/geo.ts` bilan bir xil. Shahar miqyosida (o'nlab km) yer egriligi
 * sezilmaydi: poligon tekislikda tekshiriladi, masofa — haversine bilan.
 */

const EARTH_RADIUS_KM = 6371;

export function isLatLng(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
  );
}

/** ~10 sm aniqlik — saqlash uchun yetarli. */
export function roundLatLng(point: LatLng): LatLng {
  return { lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6 };
}

/** Nuqta poligon ichidami (nur usuli); uchlari 3 tadan kam bo'lsa — yo'q. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Ikki nuqta orasidagi masofa, km (to'g'ri chiziq bo'yicha). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
