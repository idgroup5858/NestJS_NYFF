import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import {
  ApprovePurchaseDto,
  CreateIngredientDto,
  CreatePurchaseDto,
  CreateTransferDto,
  MovementsQuery,
  PurchasesQuery,
  SetMinQtyDto,
  SetTargetQtyDto,
  StockQuery,
  TransfersQuery,
  UpdateIngredientDto,
} from './warehouse.dto';
import { WarehouseService } from './warehouse.service';

/** Ombor bo'limi — ta'minotchi va admin (admin ikkala guruhni doim ko'radi). Eski kirimni tasdiqlash — faqat admin. */
@Roles('admin', 'supplier')
@Controller()
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('warehouses')
  warehouses() {
    return this.warehouse.warehouses();
  }

  @Get('ingredients')
  ingredients() {
    return this.warehouse.ingredients();
  }

  /** `lastPrice` (1 birlik narxi) — faqat admin; ta'minotchi narxsiz qo'shadi / tahrirlaydi (narxni kirimda yozadi). */
  @Post('ingredients')
  createIngredient(@Body() dto: CreateIngredientDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.saveIngredient(dto, user.role);
  }

  /** `unit` ni o'zgartirish — faqat admin; sonlar o'zgarmaydi (ogohlantirish — `usage`). */
  @Patch('ingredients/:id')
  updateIngredient(@Param('id') id: string, @Body() dto: UpdateIngredientDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.saveIngredient({ ...dto, id }, user.role);
  }

  /** Birlikni o'zgartirishdan oldin: retseptlari bor taomlar, qoldiq / chegara, hujjatlar soni (taomlar — faqat admin). */
  @Roles('admin')
  @Get('ingredients/:id/usage')
  ingredientUsage(@Param('id') id: string) {
    return this.warehouse.ingredientUsage(id);
  }

  /** Faqat hech qayerda ishlatilmagan mahsulot (retsept, kirim, ko'chirish, harakat) — aks holda `in_use`. */
  @Delete('ingredients/:id')
  @HttpCode(204)
  async removeIngredient(@Param('id') id: string) {
    await this.warehouse.removeIngredient(id);
  }

  @Get('stock')
  stock(@Query() query: StockQuery) {
    return this.warehouse.stockItems(query.warehouseId);
  }

  @Get('stock/low')
  lowStock(@Query() query: StockQuery) {
    return this.warehouse.lowStock(query.warehouseId);
  }

  @Put('stock/:warehouseId/:ingredientId/min-qty')
  setMinQty(
    @Param('warehouseId') warehouseId: string,
    @Param('ingredientId') ingredientId: string,
    @Body() dto: SetMinQtyDto,
  ) {
    return this.warehouse.setMinQty(warehouseId, ingredientId, dto.minQty);
  }

  @Put('stock/:warehouseId/:ingredientId/target-qty')
  setTargetQty(
    @Param('warehouseId') warehouseId: string,
    @Param('ingredientId') ingredientId: string,
    @Body() dto: SetTargetQtyDto,
  ) {
    return this.warehouse.setTargetQty(warehouseId, ingredientId, dto.targetQty);
  }

  /** Butun omborning qoldig'ini 0 ga tushirish (minus ham, plus ham) — faqat admin; "Tuzatish" hujjati yoziladi. */
  @Roles('admin')
  @Post('stock/:warehouseId/reset')
  @HttpCode(200)
  resetWarehouse(@Param('warehouseId') warehouseId: string, @CurrentUser() user: AuthUser) {
    return this.warehouse.resetStock(warehouseId, undefined, user.id);
  }

  /** Bitta mahsulot qoldig'ini 0 ga tushirish — faqat admin. */
  @Roles('admin')
  @Post('stock/:warehouseId/:ingredientId/reset')
  @HttpCode(200)
  resetIngredient(
    @Param('warehouseId') warehouseId: string,
    @Param('ingredientId') ingredientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.warehouse.resetStock(warehouseId, ingredientId, user.id);
  }

  @Get('movements')
  movements(@Query() query: MovementsQuery) {
    return this.warehouse.movements(query);
  }

  @Get('purchases')
  purchases(@Query() query: PurchasesQuery) {
    return this.warehouse.purchases(query);
  }

  @Get('purchases/:id')
  purchase(@Param('id') id: string) {
    return this.warehouse.purchase(id);
  }

  /** Kirim narxi bilan darhol omborga qo'shiladi (tasdiqlash yo'q), Telegram'ga "Yangi kirim" ketadi. */
  @Post('purchases')
  createPurchase(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.createPurchase(dto, user.id);
  }

  /** Tasdiqlash / rad etish — faqat eski (2026-11-08 gacha yozilgan, tasdiq kutayotgan) kirimlar uchun. */
  @Roles('admin')
  @Post('purchases/:id/approve')
  @HttpCode(200)
  approvePurchase(@Param('id') id: string, @Body() dto: ApprovePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.approvePurchase(id, dto.prices ?? {}, user.id);
  }

  @Roles('admin')
  @Post('purchases/:id/reject')
  @HttpCode(200)
  rejectPurchase(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.warehouse.rejectPurchase(id, user.id);
  }

  @Get('transfers')
  transfers(@Query() query: TransfersQuery) {
    return this.warehouse.transfers(query);
  }

  @Post('transfers')
  createTransfer(@Body() dto: CreateTransferDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.createTransfer(dto, user.id);
  }
}
