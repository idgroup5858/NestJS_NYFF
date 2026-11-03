import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { Repository } from 'typeorm';
import { fail } from '../common/errors';
import { Setting } from '../database/setting.entity';
import { Category } from '../menu/category.entity';
import { Product } from '../menu/product.entity';
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

/** `settings` kaliti: kiosk bosh ekranidagi 3 ta bezak rasmi (JSON massiv). */
const KIOSK_IMAGES_SETTING = 'kiosk_images';

/**
 * Kiosk bosh ekrani rasmlari — admin hali tanlamagan bo'lsa: o'rtada chizburger, tepada va pastda hot-dog
 * (`uploads/products` dagi fayllar).
 */
export const DEFAULT_KIOSK_IMAGES = [
  '/images/products/Screenshot_2-removebg-preview.png',
  '/images/products/pngtree-hotdog-with-sausage-and-salad-ingredients-png-image_19086249-removebg-preview.png',
  '/images/products/66e8a20acf4319d46fd00ddb276865da-removebg-preview.png',
];

/** Kiosk rasmi — faqat `uploads` dagi rasm yo'li (`/images/products/x.png`), boshqa sayt manzili emas. */
const IMAGE_PATH = /^\/images\/(products|categories)\/[^/\\]+$/;

@Injectable()
export class ImagesService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
  ) {}

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

  /**
   * Rasm faylini papkadan o'chiradi. Taomda, kategoriyada (faol bo'lmaganida ham) yoki kiosk ekranida ishlatilgan
   * bo'lsa — `image_in_use` (`detail`: qayerda), aks holda u yerlarda bo'sh rasm qolardi.
   */
  async remove(folder: string, name: string): Promise<void> {
    if (!(IMAGE_FOLDERS as readonly string[]).includes(folder)) fail('not_found', folder);
    // faqat papkaning o'zidagi fayl nomi (`../` va boshqa papkalar emas)
    if (/[/\\]/.test(name) || name.startsWith('.') || !READABLE.test(name)) fail('not_found', name);
    const path = `/images/${folder}/${name}`;
    const [products, categories, kiosk] = await Promise.all([
      this.products.countBy({ image: path }),
      this.categories.countBy({ image: path }),
      this.kioskImages(),
    ]);
    const usedIn = [
      products > 0 && `products: ${products}`,
      categories > 0 && `categories: ${categories}`,
      kiosk.includes(path) && 'kiosk',
    ].filter(Boolean);
    if (usedIn.length > 0) fail('image_in_use', usedIn.join(', '));
    try {
      await unlink(join(imagesDir(), folder, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('not_found', path);
      throw error;
    }
  }

  /** Kiosk bosh ekranidagi 3 ta rasm: o'rtadagi katta doira, tepadagi va pastdagi kichik doiralar. */
  async kioskImages(): Promise<string[]> {
    const stored = await this.settings.findOneBy({ key: KIOSK_IMAGES_SETTING });
    if (!stored) return [...DEFAULT_KIOSK_IMAGES];
    try {
      const images = JSON.parse(stored.value) as unknown;
      if (Array.isArray(images) && images.length === 3 && images.every((src) => typeof src === 'string')) {
        return images as string[];
      }
    } catch {
      // buzilgan qiymat — standartiga qaytamiz
    }
    return [...DEFAULT_KIOSK_IMAGES];
  }

  /** Admin tanlagan kiosk rasmlari — har biri `uploads` dagi rasm yo'li (bo'sh — doirada ikonka qoladi). */
  async setKioskImages(images: string[]): Promise<string[]> {
    if (images.length !== 3 || images.some((src) => src !== '' && !IMAGE_PATH.test(src))) {
      fail('invalid_input', 'images');
    }
    await this.settings.save({ key: KIOSK_IMAGES_SETTING, value: JSON.stringify(images) });
    return images;
  }

  private async info(folder: ImageFolder, name: string): Promise<ImageFile> {
    const { size, mtime } = await stat(join(imagesDir(), folder, name));
    return { path: `/images/${folder}/${name}`, folder, name, size, modifiedAt: mtime.toISOString() };
  }
}
