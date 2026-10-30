import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ConnectBotDto } from './telegram.dto';
import { TelegramService } from './telegram.service';

/** Telegram bot sozlamasi (admin "AI → Telegram"). Javob — bot holati, shu adminning start linki va ulangan chatlar. */
@Roles('admin')
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.telegram.status(user);
  }

  /** Bot tokenini kiritish / almashtirish. */
  @Put('token')
  connect(@Body() dto: ConnectBotDto, @CurrentUser() user: AuthUser) {
    return this.telegram.connect(dto.token, user);
  }

  /** Botni o'chirish (ulangan chatlar ham). */
  @Delete('token')
  @HttpCode(204)
  async disconnect() {
    await this.telegram.disconnect();
  }

  /** Yangi start link (eskisi ishlamay qoladi). */
  @Post('link')
  @HttpCode(200)
  regenerateLink(@CurrentUser() user: AuthUser) {
    return this.telegram.regenerateLink(user);
  }

  @Delete('chats/:chatId')
  @HttpCode(204)
  async unlink(@Param('chatId') chatId: string) {
    await this.telegram.unlink(chatId);
  }
}
