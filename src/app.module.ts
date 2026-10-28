import { Controller, DynamicModule, Get, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { AuthModule } from './auth/auth.module';
import { Public } from './auth/decorators';
import { BranchesModule } from './branches/branches.module';
import { CourierModule } from './courier/courier.module';
import { RevocationsModule } from './common/revocations';
import { DatabaseModule } from './database/database.module';
import { DemoModule } from './demo/demo.module';
import { ExpensesModule } from './expenses/expenses.module';
import { imagesDir } from './images/images-dir';
import { ImagesModule } from './images/images.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReportsModule } from './reports/reports.module';
import { ShiftsModule } from './shifts/shifts.module';
import { UsersModule } from './users/users.module';
import { WarehouseModule } from './warehouse/warehouse.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true };
  }
}

/**
 * Taom, kategoriya va ikonka rasmlari — `/images/...` (menyudagi `image` / `icon` yo'llari shunday). Hozircha web
 * ilovaning `public/images` papkasidan; papka bo'lmasa berilmaydi. Ro'yxat va yuklash — `ImagesModule` (`/api/images`).
 */
function imagesModule(): DynamicModule[] {
  const rootPath = imagesDir();
  if (!existsSync(rootPath)) {
    new Logger('Images').warn(`Rasmlar papkasi topilmadi (${rootPath}) — /images berilmaydi`);
    return [];
  }
  return [ServeStaticModule.forRoot({ rootPath, serveRoot: '/images' })];
}

/**
 * Tayyor web ilova (`UI_DIST`, standart — `../ReactJS_NYFF/dist`) — `/` da; `/api`, `/socket.io`, `/images` dan
 * tashqari hamma yo'l index.html ga (SPA). Papka bo'lmasa — faqat API (ishlab chiqishda UI Vite'da, 5173).
 */
function uiModule(): DynamicModule[] {
  const dir = process.env.UI_DIST || '../ReactJS_NYFF/dist';
  const rootPath = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  if (!existsSync(join(rootPath, 'index.html'))) {
    new Logger('UI').warn(`Web ilova topilmadi (${rootPath}) — faqat API ishlaydi`);
    return [];
  }
  return [
    ServeStaticModule.forRoot({ rootPath, exclude: ['/api/{*path}', '/socket.io/{*path}', '/images/{*path}'] }),
  ];
}

/** `JOBS=off` — fon ishlari (5 daqiqalik qabul muddati) o'chiq: testlar va seed uchun. */
const jobs = process.env.JOBS === 'off' ? [] : [ScheduleModule.forRoot()];

@Module({
  imports: [
    // .env birinchi yuklanadi — quyidagi modullar process.env dan o'qiydi
    ConfigModule.forRoot({ isGlobal: true }),
    ...jobs,
    // faqat `AttemptsGuard` qo'yilgan endpointlarda (PIN bilan kirish, qurilmani ulash)
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
      skipIf: () => process.env.THROTTLE === 'off',
    }),
    DatabaseModule,
    RevocationsModule,
    AuthModule,
    UsersModule,
    BranchesModule,
    RealtimeModule,
    MenuModule,
    ImagesModule,
    WarehouseModule,
    ShiftsModule,
    OrdersModule,
    CourierModule,
    ExpensesModule,
    ReportsModule,
    DemoModule,
    ...imagesModule(),
    ...uiModule(),
  ],
  controllers: [HealthController],
})
export class AppModule {}
