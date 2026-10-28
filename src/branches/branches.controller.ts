import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
