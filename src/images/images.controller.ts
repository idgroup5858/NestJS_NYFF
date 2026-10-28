import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators';
import { UploadImageDto } from './images.dto';
import { ImagesService, type UploadedImage } from './images.service';

/**
 * Admin: taom / kategoriya rasmlari — papkadagi ro'yxat (qo'lda tashlanganlari ham) va kompyuterdan yuklash
 * (multipart: `file`, `folder`). Hajm servisda tekshiriladi (`invalid_image`); multer chegarasi — xotirani himoyalash.
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
}
