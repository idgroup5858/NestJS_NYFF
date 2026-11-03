import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ScreenCodesService } from './screen-codes.service';

/**
 * Admin: filialning TV va kiosk kodlari — ko'rish (yo'q bo'lsa yaratiladi) va yangilash (eski kod bilan ekran ishlamay
 * qoladi; ulangan TV'lar darhol uziladi).
 */
@Roles('admin')
@Controller('branches')
export class ScreenCodesController {
  constructor(private readonly codes: ScreenCodesService) {}

  @Get(':id/tv-code')
  async tvCode(@Param('id') id: string) {
    return { code: await this.codes.get('tv', id) };
  }

  @Post(':id/tv-code')
  @HttpCode(200)
  async renewTvCode(@Param('id') id: string) {
    return { code: await this.codes.regenerate('tv', id) };
  }

  @Get(':id/kiosk-code')
  async kioskCode(@Param('id') id: string) {
    return { code: await this.codes.get('kiosk', id) };
  }

  @Post(':id/kiosk-code')
  @HttpCode(200)
  async renewKioskCode(@Param('id') id: string) {
    return { code: await this.codes.regenerate('kiosk', id) };
  }
}
