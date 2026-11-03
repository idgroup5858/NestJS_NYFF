import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../database/setting.entity';
import { Category } from '../menu/category.entity';
import { Product } from '../menu/product.entity';
import { ImagesController, KioskImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Category, Setting])],
  controllers: [ImagesController, KioskImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
