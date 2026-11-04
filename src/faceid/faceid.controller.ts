import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Public, Roles } from '../auth/decorators';
import { HrEventsDto } from './faceid.dto';
import { FaceIdService } from './faceid.service';
import { HrBranchId, HrGuard } from './hr.guard';
import { HrKeysService } from './hr-keys.service';

/**
 * Filial HR tizimi (FaceID davomat, kassir kompyuterida) uchun — xodim tokeni emas, filial kaliti (`X-Hr-Key`, admin
 * "Filiallar" → "HR kaliti"). HR terminaldagi «Kirish» / «Chiqish» larni yuboradi (internet yo'q bo'lsa — navbatda
 * kutadi, keyin).
 */
@Public()
@UseGuards(HrGuard)
@Controller('hr')
export class HrController {
  constructor(private readonly faceId: FaceIdService) {}

  /** HR sozlamalaridagi "Sinov" — kalit qaysi filialniki. */
  @Get('ping')
  ping(@HrBranchId() branchId: string) {
    return this.faceId.ping(branchId);
  }

  @Post('events')
  @HttpCode(200)
  events(@HrBranchId() branchId: string, @Body() dto: HrEventsDto) {
    return this.faceId.ingest(branchId, dto.events);
  }
}

/** Admin: filialning HR kaliti — ko'rish (yo'q bo'lsa yaratiladi) va yangilash (eskisi bilan HR ulana olmaydi). */
@Roles('admin')
@Controller('branches')
export class HrKeysController {
  constructor(private readonly keys: HrKeysService) {}

  @Get(':id/hr-key')
  async get(@Param('id') id: string) {
    return { key: await this.keys.get(id) };
  }

  @Post(':id/hr-key')
  @HttpCode(200)
  async regenerate(@Param('id') id: string) {
    return { key: await this.keys.regenerate(id) };
  }
}
