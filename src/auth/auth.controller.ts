import { Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShiftsService } from '../shifts/shifts.service';
import { UsersService } from '../users/users.service';
import { AttemptsGuard } from './attempts.guard';
import {
  ChangePasswordDto,
  ChangePinDto,
  LoginDto,
  PasswordLoginDto,
  StaffQuery,
  UnlockDto,
  UpdateProfileDto,
} from './auth.dto';
import { AuthService, toAuthUser } from './auth.service';
import type { AuthUser } from './auth.types';
import { CurrentUser, Public, Roles } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly shifts: ShiftsService,
  ) {}

  /** Kirish ekranidagi xodimlar ro'yxati (filial va rol bo'yicha); admin va kuryerlarsiz. */
  @Public()
  @Get('staff')
  staff(@Query() query: StaffQuery) {
    return this.auth.staff(query);
  }

  /** PIN bilan — kassir, oshpaz yordamchisi, ta'minotchi. */
  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.userId, dto.pin);
  }

  /** Admin — email va parol bilan (web `/admin`); IP bo'yicha chegara PIN kirishidagidek. */
  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('admin-login')
  @HttpCode(200)
  adminLogin(@Body() dto: PasswordLoginDto) {
    return this.auth.passwordLogin('admin', dto.email, dto.password);
  }

  /** Kuryer — email va parol bilan (mobil ilova, ismlar ro'yxatisiz). */
  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('courier-login')
  @HttpCode(200)
  courierLogin(@Body() dto: PasswordLoginDto) {
    return this.auth.passwordLogin('courier', dto.email, dto.password);
  }

  /** Sahifa yangilanganda sessiyani tiklash: xodim va (kassirda) ochiq smenasi. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user, shift: user.role === 'cashier' ? await this.shifts.current(user) : null };
  }

  /** Kassa blokdan chiqadi — o'z PIN'i bilan; yangi token. */
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('unlock')
  @HttpCode(200)
  unlock(@CurrentUser() user: AuthUser, @Body() dto: UnlockDto) {
    return this.auth.unlock(user.id, dto.pin);
  }

  @Put('pin')
  @HttpCode(204)
  changePin(@CurrentUser() user: AuthUser, @Body() dto: ChangePinDto) {
    return this.auth.changeOwnPin(user.id, dto.oldPin, dto.newPin);
  }

  /** Admin "Profil": ism, familiya, email — yangilangan xodim qaytadi. */
  @Roles('admin')
  @Put('profile')
  async updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return toAuthUser(await this.users.updateProfile(user.id, dto));
  }

  /** Admin "Profil": parol — joriysi bilan tasdiqlab. */
  @Roles('admin')
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Put('password')
  @HttpCode(204)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.oldPassword, dto.newPassword);
  }
}
