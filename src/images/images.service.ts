import { Injectable } from '@nestjs/common';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { fail } from '../common/errors';
import { imagesDir } from './images-dir';

/** Admin rasm tanlaydigan papkalar (`uploads` ichida; kategoriya ikonkalari — web ilovaning o'zida, bu yerda yo'q). */
export const IMAGE_FOLDERS = ['products', 'categories'] as const;
export type ImageFolder = (typeof IMAGE_FOLDERS)[number];

/** Yuklanadigan rasm hajmi chegarasi. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageFile {
  /** menyudagi `image` ga yoziladigan yo'l: `/images/products/cola.png` */
  path: string;
  folder: ImageFolder;
  name: string;
  size: number;
  modifiedAt: string;
}

/** Multer'ning xotiradagi fayli (kerakli maydonlari). */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Ro'yxatga kiradigan fayllar — papkaga qo'lda tashlanganlar ham. */
const READABLE = /\.(jpe?g|png|webp|avif|gif)$/i;

/** Ruxsat etilgan tur → kengaytma va fayl boshidagi belgisi (mijoz yuborgan turga ishonilmaydi). */
const FORMATS: Record<string, { ext: string; matches: (head: Buffer) => boolean }> = {
  'image/jpeg': { ext: '.jpg', matches: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  'image/png': {
    ext: '.png',
    matches: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/webp': {
    ext: '.webp',
    matches: (h) => h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP',
  },
  'image/avif': { ext: '.avif', matches: (h) => h.toString('latin1', 4, 12) === 'ftypavif' },
};

/** Fayl nomi: lotin harflari, raqam va "-" (`Cola Zero (1).PNG` → `cola-zero-1`); bo'sh qolsa — `rasm`. */
export function slugName(original: string): string {
  const slug = parse(original)
    .name.normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'rasm';
}

@Injectable()
export class ImagesService {
  /** `products` va `categories` papkalaridagi hamma rasm — eng yangisi birinchi. */
  async list(): Promise<ImageFile[]> {
    const groups = await Promise.all(
      IMAGE_FOLDERS.map(async (folder) => {
        // papka hali yo'q — bo'sh (birinchi yuklashda yaratiladi)
        const entries = await readdir(join(imagesDir(), folder), { withFileTypes: true }).catch(
          (): Dirent[] => [],
        );
        const names = entries
          .filter((entry) => entry.isFile() && READABLE.test(entry.name))
          .map((entry) => entry.name);
        return Promise.all(names.map((name) => this.info(folder, name)));
      }),
    );
    return groups
      .flat()
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
  }

  /** Rasmni papkaga saqlaydi; nom band bo'lsa — `cola-2.png`, `cola-3.png`. */
  async upload(folder: ImageFolder, file: UploadedImage | undefined): Promise<ImageFile> {
    if (!file) fail('invalid_image', 'file is missing');
    const format = FORMATS[file.mimetype] ?? fail('invalid_image', file.mimetype);
    if (file.size > MAX_IMAGE_BYTES) fail('invalid_image', `${file.size} bytes`);
    if (!format.matches(file.buffer)) fail('invalid_image', `not a ${file.mimetype} file`);

    const dir = join(imagesDir(), folder);
    await mkdir(dir, { recursive: true });
    const base = slugName(file.originalname);
    for (let n = 1; ; n++) {
      const name = `${n === 1 ? base : `${base}-${n}`}${format.ext}`;
      try {
        // `wx` — fayl bor bo'lsa yozmaydi (bir vaqtda ikki yuklash bir-birini bosib ketmasin)
        await writeFile(join(dir, name), file.buffer, { flag: 'wx' });
        return this.info(folder, name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  }

  private async info(folder: ImageFolder, name: string): Promise<ImageFile> {
    const { size, mtime } = await stat(join(imagesDir(), folder, name));
    return { path: `/images/${folder}/${name}`, folder, name, size, modifiedAt: mtime.toISOString() };
  }
}
