import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, MaxLength } from 'class-validator';
import { IMAGE_FOLDERS, type ImageFolder } from './images.service';

/** Yuklashdagi matn maydoni (multipart): qaysi papkaga. */
export class UploadImageDto {
  @IsIn(IMAGE_FOLDERS)
  folder: ImageFolder;
}

/** Kiosk bosh ekrani: 3 ta rasm yo'li (o'rtadagi, tepadagi, pastdagi). */
export class KioskImagesDto {
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  images: string[];
}
