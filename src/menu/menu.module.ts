import { Module } from '@nestjs/common';
import { CategoriesController, MenuController, ProductsController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
  controllers: [MenuController, CategoriesController, ProductsController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
