import { IsIn } from 'class-validator';
import { IMAGE_FOLDERS, type ImageFolder } from './images.service';

/** Yuklashdagi matn maydoni (multipart): qaysi papkaga. */
export class UploadImageDto {
  @IsIn(IMAGE_FOLDERS)
  folder: ImageFolder;
}
