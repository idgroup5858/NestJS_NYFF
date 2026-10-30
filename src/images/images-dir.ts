import { isAbsolute, resolve } from 'node:path';

/**
 * Taom va kategoriya rasmlari papkasi (`IMAGES_DIR`, standart — backendning `uploads` papkasi, git'ga kirmaydi). Nisbiy
 * yo'l — server ishga tushirilgan papkaga nisbatan. `/images/products/...`, `/images/categories/...` shu papkadan
 * beriladi, admin yuklagan rasm ham shu yerga. Kategoriya ikonkalari (`/images/icons/...`) — web ilovaning o'zida.
 */
export function imagesDir(): string {
  const dir = process.env.IMAGES_DIR || 'uploads';
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}
