import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { SaveUserDto } from './user.dto';
import { UsersService } from './users.service';

@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Ta'minotchi ham — kirim / ko'chirish muallifining ismi uchun (PIN va boshqa maxfiy maydonlarsiz). */
  @Roles('admin', 'supplier')
  @Get()
  findAll() {
    return this.users.findAll();
  }

  /** Kuryerlar va holati (admin "Xodimlar", kassa "Dostavka") — ochiq `/auth/staff` da kuryerlar yo'q. */
  @Roles('admin', 'cashier')
  @Get('couriers')
  couriers() {
    return this.users.couriers();
  }

  @Post()
  create(@Body() dto: SaveUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.save(dto, actor.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: SaveUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.save({ ...dto, id }, actor.id);
  }

  /** Faqat hech qayerda izi yo'q xodim (aks holda `in_use` — bloklang). */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.users.remove(id, actor.id);
  }
}
