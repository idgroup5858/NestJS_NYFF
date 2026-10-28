import { isAbsolute, resolve } from 'node:path';

/**
 * Taom, kategoriya va ikonka rasmlari papkasi (`IMAGES_DIR`, standart — web ilovaning `public/images`). Nisbiy yo'l —
 * server ishga tushirilgan papkaga nisbatan. `/images/...` shu papkadan beriladi, admin yuklagan rasm ham shu yerga.
 */
export function imagesDir(): string {
  const dir = process.env.IMAGES_DIR || '../ReactJS_NYFF/public/images';
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}
