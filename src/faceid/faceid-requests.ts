import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { AttemptsGuard } from '../auth/attempts.guard';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { Branch } from '../branches/branch.entity';
import { fail } from '../common/errors';
import type { FaceIdNeed } from '../domain/faceid';
import { Shift } from '../shifts/shift.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { TelegramService } from '../telegram/telegram.service';
import { User } from '../users/user.entity';
import { FaceIdRequestDto } from './faceid.dto';
import { FaceIdModule } from './faceid.module';
import { FaceIdService, requestView, type FaceIdRequestView } from './faceid.service';

/**
 * Kassir terminaldan o'tolmadi (terminal / HR buzilgan, internet yo'q…) — admindan Telegram orqali ruxsat so'raydi.
 * Kirish yoki blokdan chiqish ekranidan — PIN bilan (kassir hali kirmagan), ochiq kassadan (smenani topshirish) —
 * token bilan. Bot ulanmagan yoki hech bir admin chatiga yetmasa — `faceid_request_unavailable`. Javob berilmagan so'rov
 * bo'lsa — yangisi yuborilmaydi, o'sha qaytadi.
 */
@Injectable()
export class FaceIdRequestsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auth: AuthService,
    private readonly faceId: FaceIdService,
    private readonly telegram: TelegramService,
  ) {}

  async fromPin(userId: string, pin: string, branchId: string, now = new Date()): Promise<FaceIdRequestView> {
    const em = this.dataSource.manager;
    // rol PIN'dan oldin — admin / kuryer paroli bu yerda PIN sifatida sinab ko'rilmasin (kirishdagidek)
    const found = (await em.findOneBy(User, { id: userId })) ?? fail('not_found', `user ${userId}`);
    if (found.role !== 'cashier') fail('forbidden', `${found.role}: FaceID faqat kassirga`);
    const user = await this.auth.checkPin(userId, pin, now);
    if (!user.branchIds.includes(branchId)) fail('forbidden', `branch ${branchId}`);
    const open = await em.findOneBy(Shift, { cashierId: user.id, closedAt: IsNull() });
    // boshqa filialda ochiq smena — ruxsat buni hal qilmaydi (avval o'sha smena topshiriladi)
    if (open && open.branchId !== branchId) {
      const other = await em.findOneBy(Branch, { id: open.branchId });
      fail('shift_open_elsewhere', other?.name ?? open.branchId);
    }
    return this.send(user.id, branchId, open ? 'resume' : 'open', now);
  }

  async fromSession(user: AuthUser, now = new Date()): Promise<FaceIdRequestView> {
    const branchId = user.branchId ?? fail('branch_required');
    const open = await this.dataSource.manager.findOneBy(Shift, { cashierId: user.id, branchId, closedAt: IsNull() });
    return this.send(user.id, branchId, open ? 'close' : 'open', now);
  }

  private async send(userId: string, branchId: string, action: FaceIdNeed, now: Date): Promise<FaceIdRequestView> {
    if (!(await this.telegram.hasAdminChats())) fail('faceid_request_unavailable');
    const { request, created } = await this.faceId.createRequest(userId, branchId, action, now);
    if (created) {
      const messages = await this.telegram.sendFaceIdRequest(request);
      if (messages.length === 0) {
        await this.faceId.dropRequest(request.id);
        fail('faceid_request_unavailable');
      }
      await this.faceId.saveMessages(request.id, messages);
    }
    return requestView(request, now);
  }
}

@Controller()
export class FaceIdRequestsController {
  constructor(
    private readonly requests: FaceIdRequestsService,
    private readonly faceId: FaceIdService,
  ) {}

  /** Kirish / blokdan chiqish ekranidan — PIN bilan (IP chegarasi PIN kirishidagidek). */
  @Public()
  @UseGuards(AttemptsGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('auth/faceid-request')
  @HttpCode(200)
  fromPin(@Body() dto: FaceIdRequestDto) {
    return this.requests.fromPin(dto.userId, dto.pin, dto.branchId);
  }

  /** Kassa javobni kutadi (bir necha soniyada) — id tasodifiy, so'ragan kassada. */
  @Public()
  @Get('auth/faceid-request/:id')
  view(@Param('id') id: string) {
    return this.faceId.requestView(id);
  }

  /** Ochiq kassadan — "Smenani topshirish" uchun (yoki smena yo'q bo'lsa — ochish uchun). */
  @Roles('cashier')
  @Post('shifts/current/faceid-request')
  @HttpCode(200)
  fromSession(@CurrentUser() user: AuthUser) {
    return this.requests.fromSession(user);
  }
}

@Module({
  imports: [AuthModule, TelegramModule, FaceIdModule],
  controllers: [FaceIdRequestsController],
  providers: [FaceIdRequestsService],
})
export class FaceIdRequestsModule {}
