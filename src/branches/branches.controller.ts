import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Public, Roles } from '../auth/decorators';
import { RouteQuery, SaveBranchDto, SaveDeliveryDto, SetOnlineDto } from './branch.dto';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** Kirish ekrani, mobil ilova, admin: filiallar va hozirgi online holati (`onlineState`). */
  @Public()
  @Get()
  findAll() {
    return this.branches.findAll();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.branches.findOne(id);
  }

  @Roles('admin')
  @Post()
  create(@Body() dto: SaveBranchDto) {
    return this.branches.create(dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: SaveBranchDto) {
    return this.branches.update(id, dto);
  }

  /** Faqat hech qayerda ishlatilmagan filial (aks holda `in_use` — faolsizlantiring); ombori ham o'chadi. */
  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.branches.remove(id);
  }

  @Roles('admin')
  @Put(':id/delivery')
  saveDelivery(@Param('id') id: string, @Body() dto: SaveDeliveryDto) {
    return this.branches.saveDelivery(id, dto);
  }

  @Roles('admin')
  @Put(':id/online')
  setOnline(@Param('id') id: string, @Body() dto: SetOnlineDto) {
    return this.branches.setOnline(id, dto.enabled);
  }

  /** FaceID tekshiruvi — kassir smenani filial terminalidan o'tib ochadi / topshiradi. */
  @Roles('admin')
  @Put(':id/faceid')
  setFaceId(@Param('id') id: string, @Body() dto: SetOnlineDto) {
    return this.branches.setFaceId(id, dto.enabled);
  }

  /** Oshpaz yordamchisi yo'q filial: kassir ham "Tayyor" / "Qaytarish" bosadi. */
  @Roles('admin')
  @Put(':id/cashier-ready')
  setCashierMarksReady(@Param('id') id: string, @Body() dto: SetOnlineDto) {
    return this.branches.setCashierMarksReady(id, dto.enabled);
  }
}

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly branches: BranchesService) {}

  /** Xaritadagi nuqta → qaysi filial oladi va yetkazish narxi (mobil ilova, admin "Tekshirish"). */
  @Public()
  @Get('route')
  route(@Query() query: RouteQuery) {
    return this.branches.route({ lat: query.lat, lng: query.lng }, new Date());
  }
}
