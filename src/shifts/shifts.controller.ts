import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { fail } from '../common/errors';
import { ShiftListQuery } from './shift.dto';
import { ShiftsService } from './shifts.service';

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  /** `{ shift }` — ochiq smena yoki `null` (javob tanasi bo'sh bo'lmasin). */
  @Roles('cashier')
  @Get('current')
  async current(@CurrentUser() user: AuthUser) {
    return { shift: await this.shifts.current(user) };
  }

  /**
   * Smena ochiq ekanini ta'minlaydi (boshqa tabda topshirilgan bo'lsa — yangisi ochiladi; FaceID filialida — «Kirish»
   * bilan). Ochiq smena — FaceID tekshiruvisiz (kassa har sotuvdan oldin chaqiradi).
   */
  @Roles('cashier')
  @Post('current')
  @HttpCode(200)
  openOrResume(@CurrentUser() user: AuthUser) {
    return this.shifts.openOrResume(user.id, user.branchId ?? fail('branch_required'), new Date(), false);
  }

  /** "Smenani topshirish" — yopiladi, hisobot uchun jami bilan qaytadi. */
  @Roles('cashier')
  @Post('current/close')
  @HttpCode(200)
  closeOwn(@CurrentUser() user: AuthUser) {
    return this.shifts.closeOwn(user);
  }

  @Roles('admin')
  @Get()
  findAll(@Query() query: ShiftListQuery) {
    return this.shifts.findAll(query);
  }

  @Roles('admin', 'cashier')
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.shifts.findOne(id, user);
  }

  /** Kassir yopmay ketgan smenani admin yopadi (aks holda filial online buyurtma olaveradi). */
  @Roles('admin')
  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.shifts.close(id, new Date(), user);
  }
}
