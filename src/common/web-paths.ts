import { isAbsolute, resolve } from 'node:path';

/**
 * Xodimlar tizimi (web ilova — kassa, oshxona, ombor, TV, kiosk, admin) domenning qaysi yo'lida ochiladi: `UI_BASE`,
 * standart `/shorva`. 2026-11-03 qarori: domen ildizida emas — mijoz `newyork24.uz` ni tersa xodimlar kirish ekraniga
 * tushmasin (yashirin yo'l, qulf emas: himoya — PIN, admin paroli, TV / kiosk kodlari). Web ilova ham shu yo'l bilan
 * build qilinadi (`ReactJS_NYFF/vite.config.ts` — o'sha `UI_BASE`). `/api`, `/socket.io`, `/images` — ildizda qoladi.
 */
export function uiBase(): string {
  const value = (process.env.UI_BASE ?? '').trim().replace(/^\/+|\/+$/g, '');
  return `/${value || 'shorva'}`;
}

const fromCwd = (dir: string) => (isAbsolute(dir) ? dir : resolve(process.cwd(), dir));

/** Tayyor web ilova (`ReactJS_NYFF`: `npm run build` → `dist`). */
export const uiDist = () => fromCwd(process.env.UI_DIST || '../ReactJS_NYFF/dist');

/**
 * Domen ildizidagi sahifa (`SITE_DIR`, standart — web ilovaning `site` papkasi; hozircha vaqtinchalik bosh sahifa).
 * UI fayllari faqat web loyihada — backendda sahifa saqlanmaydi.
 */
export const siteDir = () => fromCwd(process.env.SITE_DIR || '../ReactJS_NYFF/site');
