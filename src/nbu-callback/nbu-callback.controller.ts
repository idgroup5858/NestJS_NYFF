import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { NbuAuthGuard } from './nbu-auth.guard';
import { NbuCallbackService } from './nbu-callback.service';

@Controller('callback')
export class NbuCallbackController {
  constructor(private readonly callbackService: NbuCallbackService) {}

  /**
   * Bank (Milliy Ecom) to'lov natijasini yuboradi — Basic login / parol bilan. Tana xom holida olinadi: DTO klassi
   * bo'lsa global `ValidationPipe` (`whitelist`) dekoratorsiz maydonlarni o'chirib, tana bo'sh qolardi.
   */
  @Public()
  @UseGuards(NbuAuthGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Body() body: Record<string, unknown>) {
    await this.callbackService.process(body);
    return { status: 'accepted' };
  }
}
