import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { NbuCallDto, NbuConfigDto, NbuSessionDto } from './nbu-test.dto';
import { NbuTestService } from './nbu-test.service';

/**
 * Milliy Ecom (NBU) sinov sahifasi (`/shorva/nbu/test`) uchun — faqat admin. Bank javobi har doim 200 bilan qaytadi
 * (`ok`, `error`, `response.httpStatus` ichida) — sahifa xatoni ham jurnalda ko'rsatadi.
 */
@Roles('admin')
@Controller('nbu-test')
export class NbuTestController {
  constructor(private readonly nbu: NbuTestService) {}

  @Get('state')
  state() {
    return this.nbu.state();
  }

  @Post('call')
  @HttpCode(200)
  call(@Body() dto: NbuCallDto) {
    return this.nbu.call(dto.op, dto.body);
  }

  @Put('config')
  config(@Body() dto: NbuConfigDto) {
    return this.nbu.setConfig(dto);
  }

  @Put('session')
  session(@Body() dto: NbuSessionDto) {
    return this.nbu.setSession(dto);
  }

  @Post('reset')
  @HttpCode(200)
  reset() {
    return this.nbu.reset();
  }

  @Get('ip')
  ip() {
    return this.nbu.serverIp();
  }
}
