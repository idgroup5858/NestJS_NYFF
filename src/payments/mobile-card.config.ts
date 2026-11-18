/**
 * Mobil ilovada karta bilan to'lov shu serverda yoqiqmi. Kod hamma serverda bir xil — farqi faqat `.env` da: quyidagi
 * sozlamalar to'liq bo'lsa yoqiladi, bittasi bo'sh bo'lsa ham o'chiq — ilovada "Karta" — "Tez kunda" bo'lib qoladi
 * (buyurtmalar avvalgidek naqd).
 */

const REQUIRED = [
  'NBU_API_KEY',
  'NBU_SECRET_KEY',
  'NBU_USERNAME',
  'NBU_PASSWORD',
  // bank callback'i (`/api/callback`) shu login / parol bilan keladi
  'NBU_CALLBACK_USERNAME',
  'NBU_CALLBACK_PASSWORD',
] as const;

/** Bank sahifasi standart 15 daqiqa ochiq turadi (ovqat buyurtmasi uchun soat — ko'p); 5 daqiqa … 1 soat. */
const DEFAULT_SESSION_SECONDS = 900;

/** To'lovdan keyin bank qaytaradigan sahifa — ilova WebView'da shu manzil boshlanishini ushlab, oynani yopadi. */
export const RETURN_PATH = '/api/mobile/payments/return';

export interface MobileCardConfig {
  /**
   * Qaytish manzili domeni (`https://fast.newyork24.uz`, oxirida `/` siz) — faqat `.env` da `PUBLIC_URL` yozilgan
   * bo'lsa; odatda `null`: domen ilova murojaat qilgan manzildan olinadi ([requestOrigin]).
   */
  publicUrl: string | null;
  sessionSeconds: number;
}

/**
 * `missing` — yetishmagan sozlamalar: birortasi ham yozilmagan bo'lsa bo'sh (karta bu serverda ko'zda tutilmagan, logga
 * hech narsa yozilmaydi); qisman yozilgan bo'lsa — qaysilari yo'q (server ishga tushganda logda).
 */
export function mobileCardSetup(env: NodeJS.ProcessEnv = process.env): { config: MobileCardConfig | null; missing: string[] } {
  const value = (name: string) => env[name]?.trim() ?? '';
  const missing: string[] = REQUIRED.filter((name) => !value(name));
  if (missing.length === REQUIRED.length) return { config: null, missing: [] };
  const publicUrl = value('PUBLIC_URL').replace(/\/+$/, '');
  if (publicUrl && !/^https?:\/\/[^/\s]+$/i.test(publicUrl)) missing.push("PUBLIC_URL (https://domen ko'rinishida yoki bo'sh)");
  if (missing.length) return { config: null, missing };
  const seconds = Number.parseInt(value('NBU_SESSION_TIMEOUT'), 10);
  return {
    config: {
      publicUrl: publicUrl || null,
      sessionSeconds: Number.isFinite(seconds) ? Math.min(3600, Math.max(300, seconds)) : DEFAULT_SESSION_SECONDS,
    },
    missing: [],
  };
}

export function mobileCardConfig(env: NodeJS.ProcessEnv = process.env): MobileCardConfig | null {
  return mobileCardSetup(env).config;
}

/** Lokal tarmoq / port bilan manzil (ishlab chiqish, emulyator) — `https` emas. */
const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)|:\d+$/i;

/**
 * Ilova murojaat qilgan manzil — Android'da qattiq yozilgan server (`https://fast.newyork24.uz`). Bank to'lovdan keyin
 * mijozni shu domendagi qaytish sahifasiga yuboradi. [host] — so'rovdagi domen (Apache ortida — `X-Forwarded-Host`,
 * Express `req.host`); haqiqiy domen — doim `https`, lokal manzil — so'rovdagi protokol.
 */
export function requestOrigin(host: string | undefined, protocol: string): string | null {
  const clean = host?.split(',')[0]?.trim().toLowerCase() ?? '';
  if (!clean || !/^[a-z0-9.\-:[\]]+$/.test(clean)) return null;
  return `${LOCAL_HOST.test(clean) ? protocol : 'https'}://${clean}`;
}
