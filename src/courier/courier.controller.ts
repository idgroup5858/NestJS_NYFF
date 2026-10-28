import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { DutyDto, ReturnOrderDto } from './courier.dto';
import { CourierService } from './courier.service';

/** Kuryer ilovasi (PIN bilan kirgan kuryer). Buyruqlar javobi — kuryerning yangilangan ro'yxati `{ active, done }`. */
@Roles('courier')
@Controller('courier')
export class CourierController {
  constructor(private readonly courier: CourierService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.courier.me(user);
  }

  @Put('duty')
  duty(@CurrentUser() user: AuthUser, @Body() dto: DutyDto) {
    return this.courier.setDuty(user, dto.onDuty);
  }

  /** "Yangi": hali hech kim olmagan dostavkalar (masofa, yo'lga qo'shimchasi, olib bo'lmasa — sababi bilan). */
  @Get('orders/available')
  available(@CurrentUser() user: AuthUser) {
    return this.courier.available(user);
  }

  @Get('orders')
  orders(@CurrentUser() user: AuthUser) {
    return this.courier.orders(user);
  }

  @Post('orders/:id/take')
  @HttpCode(200)
  take(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.courier.take(user, id);
  }

  @Post('orders/:id/release')
  @HttpCode(200)
  release(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.courier.release(user, id);
  }

  @Post('depart')
  @HttpCode(200)
  depart(@CurrentUser() user: AuthUser) {
    return this.courier.depart(user);
  }

  @Post('orders/:id/deliver')
  @HttpCode(200)
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.courier.deliver(user, id);
  }

  @Post('orders/:id/return')
  @HttpCode(200)
  returnOrder(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReturnOrderDto) {
    return this.courier.returnOrder(user, id, dto);
  }
}
