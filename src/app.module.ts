import { Controller, DynamicModule, Get, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { Public } from './auth/decorators';
import { BranchesModule } from './branches/branches.module';
import { CourierModule } from './courier/courier.module';
import { RevocationsModule } from './common/revocations';
import { siteDir, uiBase, uiDist } from './common/web-paths';
import { DatabaseModule } from './database/database.module';
import { ExpensesModule } from './expenses/expenses.module';
import { imagesDir } from './images/images-dir';
import { ImagesModule } from './images/images.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReportsModule } from './reports/reports.module';
import { SetupModule } from './setup/setup.module';
import { ShiftsModule } from './shifts/shifts.module';
import { SyncModule } from './sync/sync.module';
import { TelegramModule } from './telegram/telegram.module';
import { ScreensModule } from './screens/screens.module';
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
 * Taom va kategoriya rasmlari — `/images/products/...`, `/images/categories/...` (menyudagi `image` yo'llari shunday),
 * backendning `uploads` papkasidan (`IMAGES_DIR`); papka bo'lmasa yaratiladi. Ro'yxat va yuklash — `ImagesModule`
 * (`/api/images`). Bu yerda topilmagan fayl keyingisiga o'tadi (`exclude`): kategoriya ikonkalari (`/images/icons/...`)
 * — web ilovaning o'zida, `uiModule` beradi.
 */
function imagesModule(): DynamicModule[] {
  const rootPath = imagesDir();
  mkdirSync(rootPath, { recursive: true });
  return [ServeStaticModule.forRoot({ rootPath, serveRoot: '/images', exclude: ['/images/{*path}'] })];
}

/**
 * Tayyor web ilova (`UI_DIST`, standart — `../ReactJS_NYFF/dist`) — xodimlar tizimi, `UI_BASE` (`/shorva`) ostida:
 * `/shorva/...` dagi hamma yo'l index.html ga (SPA), `/shorva` → `/shorva/`. Kategoriya ikonkalari — domen ildizida
 * ham (`/images/icons/...`): bazadagi `icon` yo'llari va mobil ilova shu manzil bilan. Papka bo'lmasa — faqat API
 * (ishlab chiqishda UI Vite'da, `http://localhost:5173/shorva/`).
 */
function uiModule(): DynamicModule[] {
  const rootPath = uiDist();
  if (!existsSync(join(rootPath, 'index.html'))) {
    new Logger('UI').warn(`Web ilova topilmadi (${rootPath}) — faqat API ishlaydi`);
    return [];
  }
  return [
    ServeStaticModule.forRoot({ rootPath, serveRoot: uiBase() }),
    ServeStaticModule.forRoot({ rootPath: join(rootPath, 'images', 'icons'), serveRoot: '/images/icons', exclude: ['/images/{*path}'] }),
  ];
}

/**
 * Domen ildizi (`newyork24.uz`) — xodimlar tizimi emas, alohida sahifa (`SITE_DIR`, standart `site`; hozircha
 * vaqtinchalik bosh sahifa — logo). `/api`, `/socket.io`, `/images` va xodimlar tizimidan tashqari hamma yo'l shu
 * sahifaga (eski `/kassa`, `/admin` zakladkalari ham — xodimlar tizimi manzili oshkor bo'lmasin, yo'naltirilmaydi).
 */
function siteModule(): DynamicModule[] {
  const rootPath = siteDir();
  if (!existsSync(join(rootPath, 'index.html'))) return [];
  const base = uiBase();
  return [
    ServeStaticModule.forRoot({
      rootPath,
      exclude: ['/api/{*path}', '/socket.io/{*path}', '/images/{*path}', base, `${base}/{*path}`],
    }),
  ];
}

/** `JOBS=off` — fon ishlari (5 daqiqalik qabul muddati) o'chiq: testlar uchun. */
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
    AiModule,
    TelegramModule,
    BackupModule,
    SetupModule,
    SyncModule,
    ScreensModule,
    // tartib muhim: rasmlar → xodimlar tizimi → ildizdagi sahifa (u qolgan hamma yo'lni oladi)
    ...imagesModule(),
    ...uiModule(),
    ...siteModule(),
  ],
  controllers: [HealthController],
})
export class AppModule {}
