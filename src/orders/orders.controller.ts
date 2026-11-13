import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AttemptsGuard } from '../auth/attempts.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { fail } from '../common/errors';
import { SCREEN_CODE_HEADER, ScreenCodesService } from '../screens/screen-codes.service';
import {
  BranchScopeQuery,
  ConfirmOrderDto,
  CreateOrderDto,
  KioskOrderDto,
  MobileOrderDto,
  OrdersQuery,
  TrackingQuery,
} from './order.dto';
import { OrdersService } from './orders.service';

/** Filial xodimi doim o'z filialini ko'radi; admin — so'rovdagi filialni (majburiy). */
function scopeBranch(user: AuthUser | undefined, query: BranchScopeQuery): string {
  if (user?.branchId) return user.branchId;
  return query.branchId ?? fail('branch_required');
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Roles('cashier')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.createByCashier(user, dto);
  }

  /** Ishdagi buyurtmalar: kassada to'lanmagan kiosk, qabul kutayotgan mobil, tayyorlanayotganlar. */
  @Roles('cashier', 'kitchen', 'admin')
  @Get('active')
  active(@CurrentUser() user: AuthUser, @Query() query: BranchScopeQuery) {
    return this.orders.active(scopeBranch(user, query));
  }

  /** Yaqinda (5 daqiqada) tayyor bo'lganlar. */
  @Roles('cashier', 'kitchen', 'admin')
  @Get('ready')
  ready(@CurrentUser() user: AuthUser, @Query() query: BranchScopeQuery) {
    return this.orders.recentReady(scopeBranch(user, query));
  }

  /** Kuryer ishidagi dostavkalar: kuryer kutayotgan, olingan, yo'ldagi, qaytgan (hali yetkazilmagan). */
  @Roles('cashier', 'admin')
  @Get('delivery')
  delivery(@CurrentUser() user: AuthUser, @Query() query: BranchScopeQuery) {
    return this.orders.deliveries(scopeBranch(user, query));
  }

  @Roles('admin')
  @Get()
  findAll(@Query() query: OrdersQuery) {
    return this.orders.findAll(query);
  }

  @Roles('cashier', 'kitchen', 'admin')
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.findOne(id, user);
  }

  /** Kiosk buyurtmasining pulini olish yoki mobil buyurtmani qabul qilish → oshxonaga. */
  @Roles('cashier')
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: ConfirmOrderDto) {
    return this.orders.confirm(id, user, dto);
  }

  /** Oshpaz yordamchisi; kassir — faqat filialda `cashierMarksReady` yoqilgan bo'lsa (servis tekshiradi). */
  @Roles('kitchen', 'cashier')
  @Post(':id/ready')
  @HttpCode(200)
  markReady(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.markReady(id, user);
  }

  @Roles('kitchen', 'cashier')
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.reopen(id, user);
  }

  @Roles('cashier', 'admin')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.cancel(id, user);
  }

  /** Dostavkani kuryerdan olish ("Yetkazib bo'lmadi" bilan qaytgan va h.k.) — yana kuryerlarning "Yangi" ro'yxatiga. */
  @Roles('cashier', 'admin')
  @Post(':id/release-courier')
  @HttpCode(200)
  releaseCourier(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.releaseCourier(id, user);
  }
}

/**
 * Kiosk — PINsiz, filial kiosk kodi bilan (`X-Kiosk-Code`, admin "Filiallar" → "Kiosk kodi"; kirish ekranida filial
 * tanlanadi); filial so'rovda keladi. Menyu (`GET /menu`) — ochiq, mobil ilova bilan umumiy.
 */
@Controller('kiosk')
export class KioskController {
  constructor(
    private readonly orders: OrdersService,
    private readonly screenCodes: ScreenCodesService,
  ) {}

  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('orders')
  async create(@Body() dto: KioskOrderDto, @Headers(SCREEN_CODE_HEADER.kiosk) code?: string) {
    await this.screenCodes.assert('kiosk', dto.branchId, code);
    return this.orders.createByKiosk(dto);
  }

  /** Kiosk kodi to'g'rimi — kod kiritilganda va har yangi mijozdan oldin (admin yangilagan bo'lishi mumkin). */
  @Public()
  @Get('check')
  async check(@Query() query: BranchScopeQuery, @Headers(SCREEN_CODE_HEADER.kiosk) code?: string) {
    await this.screenCodes.assert('kiosk', query.branchId ?? fail('branch_required'), code);
    return { ok: true };
  }
}

@Controller('tv')
export class TvController {
  constructor(
    private readonly orders: OrdersService,
    private readonly screenCodes: ScreenCodesService,
  ) {}

  /**
   * TV navbat: "Tayyorlanmoqda" va "Tayyor" — faqat raqam, tur va holat. Xodim tokeni emas — filial TV kodi
   * (`X-Tv-Code`, admin "Filiallar" → "TV kodi"); `branchId` majburiy.
   */
  @Public()
  @Get('queue')
  async queue(@Query() query: BranchScopeQuery, @Headers(SCREEN_CODE_HEADER.tv) code?: string) {
    const branchId = query.branchId ?? fail('branch_required');
    await this.screenCodes.assert('tv', branchId, code);
    return this.orders.tvQueue(branchId);
  }
}

@Controller('mobile')
export class MobileController {
  constructor(private readonly orders: OrdersService) {}

  /** Javob: `{ order, trackingToken }` — token ilovada saqlanadi, holatni kuzatish faqat u bilan. */
  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('orders')
  create(@Body() dto: MobileOrderDto) {
    return this.orders.createByMobile(dto);
  }

  /** Buyurtma holati: `X-Order-Token` sarlavhasi yoki `?token=`. */
  @Public()
  @Get('orders/:id')
  track(@Param('id') id: string, @Query() query: TrackingQuery, @Headers('x-order-token') header?: string) {
    return this.orders.track(id, header || query.token);
  }
}
