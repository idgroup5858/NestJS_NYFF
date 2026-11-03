import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Public, Roles } from '../auth/decorators';
import { MenuQuery, MoveDto, SaveCategoryDto, SaveProductDto } from './menu.dto';
import { MenuService } from './menu.service';

/** Kassa, kiosk va mobil ilova menyusi — filialda sotuvdagi taomlar narxi bilan. */
@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Public()
  @Get()
  publicMenu(@Query() query: MenuQuery) {
    return this.menu.publicMenu(query.branchId, query.all ?? false);
  }
}

@Roles('admin')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  findAll() {
    return this.menu.categories();
  }

  @Post()
  create(@Body() dto: SaveCategoryDto) {
    return this.menu.saveCategory(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: SaveCategoryDto) {
    return this.menu.saveCategory({ ...dto, id });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.menu.removeCategory(id);
  }

  @Post(':id/move')
  @HttpCode(204)
  async move(@Param('id') id: string, @Body() dto: MoveDto) {
    await this.menu.moveCategory(id, dto.direction);
  }
}

@Roles('admin')
@Controller('products')
export class ProductsController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  findAll() {
    return this.menu.products();
  }

  @Post()
  create(@Body() dto: SaveProductDto) {
    return this.menu.saveProduct(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: SaveProductDto) {
    return this.menu.saveProduct({ ...dto, id });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.menu.removeProduct(id);
  }

  @Post(':id/move')
  @HttpCode(204)
  async move(@Param('id') id: string, @Body() dto: MoveDto) {
    await this.menu.moveProduct(id, dto.direction);
  }
}
