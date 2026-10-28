import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
  StockQuery,
  TransfersQuery,
  UpdateIngredientDto,
} from './warehouse.dto';
import { WarehouseService } from './warehouse.service';

/** Ombor bo'limi — ta'minotchi va admin (admin ikkala guruhni doim ko'radi). Kirimni tasdiqlash — faqat admin. */
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

  /** `lastPrice` (1 birlik narxi) — faqat admin; ta'minotchi narxsiz qo'shadi / tahrirlaydi. */
  @Post('ingredients')
  createIngredient(@Body() dto: CreateIngredientDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.saveIngredient(dto, user.role);
  }

  @Patch('ingredients/:id')
  updateIngredient(@Param('id') id: string, @Body() dto: UpdateIngredientDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.saveIngredient({ ...dto, id }, user.role);
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

  @Post('purchases')
  createPurchase(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.warehouse.createPurchase(dto, user.id);
  }

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
