import { HttpException } from '@nestjs/common';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImagesService, MAX_IMAGE_BYTES, slugName, type UploadedImage } from './images.service';

/** Vaqtinchalik papkada (`IMAGES_DIR`): ro'yxat, nomni tozalash, band nom, rad etiladigan fayllar. */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

const png = (originalname: string, buffer = PNG): UploadedImage => ({
  originalname,
  mimetype: 'image/png',
  size: buffer.length,
  buffer,
});

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { code?: string }).code;
  }
  return undefined;
}

describe('rasmlar', () => {
  const service = new ImagesService();
  let dir: string;
  const previous = process.env.IMAGES_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nyff-images-'));
    process.env.IMAGES_DIR = dir;
  });

  afterEach(async () => {
    process.env.IMAGES_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it("nom: lotin harflari, raqam va '-'; bo'sh qolsa — rasm", () => {
    expect(slugName('Cola Zero (1).PNG')).toBe('cola-zero-1');
    expect(slugName("Lavash go'shtli.jpeg")).toBe('lavash-go-shtli');
    expect(slugName('Café crème.png')).toBe('cafe-creme');
    expect(slugName('Бургер.png')).toBe('rasm');
  });

  it("ro'yxat: products va categories, faqat rasmlar, eng yangisi birinchi; papka yo'q — bo'sh", async () => {
    expect(await service.list()).toEqual([]);
    await mkdir(join(dir, 'products'));
    await mkdir(join(dir, 'categories'));
    await mkdir(join(dir, 'icons'));
    await writeFile(join(dir, 'products', 'old (1).png'), PNG);
    await writeFile(join(dir, 'products', 'notes.txt'), 'x');
    await writeFile(join(dir, 'categories', 'new.JPG'), JPG);
    await writeFile(join(dir, 'icons', 'pizza.png'), PNG);
    await utimes(join(dir, 'products', 'old (1).png'), new Date('2026-01-01'), new Date('2026-01-01'));

    const list = await service.list();
    expect(list.map((image) => image.path)).toEqual([
      '/images/categories/new.JPG',
      '/images/products/old (1).png',
    ]);
    expect(list[1]).toMatchObject({ folder: 'products', name: 'old (1).png', size: PNG.length });
  });

  it("yuklash: papka yaratiladi, nom tozalanadi, band bo'lsa — -2, -3", async () => {
    const first = await service.upload('products', png('Cola Zero.png'));
    const second = await service.upload('products', png('cola zero.png'));
    const third = await service.upload('products', png('COLA-ZERO.png'));
    expect([first.path, second.path, third.path]).toEqual([
      '/images/products/cola-zero.png',
      '/images/products/cola-zero-2.png',
      '/images/products/cola-zero-3.png',
    ]);
    expect(await readFile(join(dir, 'products', 'cola-zero.png'))).toEqual(PNG);
    expect((await service.list()).length).toBe(3);
  });

  it('kengaytma faylning haqiqiy turidan: .jpeg nomli JPG → .jpg', async () => {
    const image = await service.upload('categories', {
      originalname: 'Burger.JPEG',
      mimetype: 'image/jpeg',
      size: JPG.length,
      buffer: JPG,
    });
    expect(image.path).toBe('/images/categories/burger.jpg');
  });

  it("rad etiladi: fayl yo'q, ruxsatsiz tur, ichi boshqa tur, 5 MB dan katta", async () => {
    expect(await codeOf(service.upload('products', undefined))).toBe('invalid_image');
    expect(await codeOf(service.upload('products', { ...png('a.svg'), mimetype: 'image/svg+xml' }))).toBe(
      'invalid_image',
    );
    expect(await codeOf(service.upload('products', png('fake.png', JPG)))).toBe('invalid_image');
    expect(await codeOf(service.upload('products', { ...png('big.png'), size: MAX_IMAGE_BYTES + 1 }))).toBe(
      'invalid_image',
    );
    expect(await service.list()).toEqual([]);
  });
});
