import { Controller, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { fail } from '../common/errors';
import { DemoService } from './demo.service';

@Roles('admin')
@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  /**
   * Admin "Demo ma'lumotlarni tiklash": hamma narsa o'chadi va boshlang'ich demo manzara (tarix, bugungi buyurtmalar,
   * hujjatlar) qaytadan yoziladi. Faqat `DEMO=1` da — haqiqiy ishga tushirishda ma'lumot o'chib ketmasin.
   */
  @Post('reset')
  @HttpCode(204)
  async reset(): Promise<void> {
    if (process.env.DEMO !== '1') fail('forbidden', 'demo off');
    await this.demo.reset({ activity: true });
  }
}
