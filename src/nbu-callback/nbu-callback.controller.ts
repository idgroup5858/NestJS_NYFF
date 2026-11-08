import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { NbuAuthGuard } from './nbu-auth.guard';
import { NbuCallbackService } from './nbu-callback.service';
import { NbuCallbackDto } from './nbu-callback.dto';
import { Public } from '../auth/decorators';

@Controller('callback')
export class NbuCallbackController {
  constructor(private readonly callbackService: NbuCallbackService) {}

 
  @Public()
  @UseGuards(NbuAuthGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Body() dto: NbuCallbackDto) {
    await this.callbackService.process(dto);
    return { status: 'accepted' };
  }
}