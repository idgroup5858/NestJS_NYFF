import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public, Roles } from '../auth/decorators';
import { KioskImagesDto, UploadImageDto } from './images.dto';
import { ImagesService, type UploadedImage } from './images.service';

/**
 * Admin: taom / kategoriya rasmlari — papkadagi ro'yxat (qo'lda tashlanganlari ham), kompyuterdan yuklash
 * (multipart: `file`, `folder`) va o'chirish (ishlatilmagan bo'lsa). Hajm servisda tekshiriladi (`invalid_image`);
 * multer chegarasi — xotirani himoyalash.
 */
@Roles('admin')
@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get()
  list() {
    return this.images.list();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@Body() dto: UploadImageDto, @UploadedFile() file: UploadedImage | undefined) {
    return this.images.upload(dto.folder, file);
  }

  @Delete(':folder/:name')
  @HttpCode(204)
  async remove(@Param('folder') folder: string, @Param('name') name: string) {
    await this.images.remove(folder, name);
  }
}

/** Kiosk bosh ekranidagi 3 ta bezak rasmi: kiosk o'qiydi (kodsiz — bezak, maxfiy emas), admin almashtiradi. */
@Controller('kiosk/images')
export class KioskImagesController {
  constructor(private readonly images: ImagesService) {}

  @Public()
  @Get()
  async get() {
    return { images: await this.images.kioskImages() };
  }

  @Roles('admin')
  @Put()
  async set(@Body() dto: KioskImagesDto) {
    return { images: await this.images.setKioskImages(dto.images) };
  }
}
