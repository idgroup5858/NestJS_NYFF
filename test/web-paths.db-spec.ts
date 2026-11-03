import type { INestApplication } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

/**
 * Manzillar (2026-11-03): domen ildizi — alohida sahifa (`SITE_DIR`), xodimlar tizimi — `/shorva` (`UI_BASE`) ostida;
 * `/api`, `/images` (kategoriya ikonkalari ham) — ildizda. Eski `/kassa`, `/admin` — ildizdagi sahifa (xodimlar tizimi
 * manzili oshkor bo'lmasin, yo'naltirilmaydi). Web ilova va sahifa — vaqtinchalik papkalarda (soxta build).
 */
describe('manzillar: ildizdagi sahifa va /shorva', () => {
  let app: INestApplication;
  const dirs: string[] = [];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const ui = mkdtempSync(join(tmpdir(), 'nyff-ui-'));
    const site = mkdtempSync(join(tmpdir(), 'nyff-site-'));
    dirs.push(ui, site);
    writeFileSync(join(ui, 'index.html'), '<html>NYFF-APP</html>');
    mkdirSync(join(ui, 'assets'));
    writeFileSync(join(ui, 'assets', 'app.js'), 'console.log("app")');
    mkdirSync(join(ui, 'images', 'icons'), { recursive: true });
    writeFileSync(join(ui, 'images', 'icons', 'burger.png'), 'ICON');
    writeFileSync(join(site, 'index.html'), '<html>NYFF-SITE Tez orada</html>');
    process.env.UI_DIST = ui;
    process.env.SITE_DIR = site;
    delete process.env.UI_BASE;
    // AppModule papkalarni import paytida o'qiydi — muhit o'zgaruvchilaridan keyin yuklanadi. `NestFactory` (main.ts
    // dagidek): `Test.createTestingModule` da ServeStaticModule HTTP adapterni ko'rmaydi va fayl bermaydi (NoopLoader)
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('ildiz — sahifa; eski xodim manzillari ham sahifa (xodimlar tizimiga yo\'naltirilmaydi)', async () => {
    expect((await http().get('/').expect(200)).text).toContain('NYFF-SITE');
    for (const path of ['/kassa', '/admin', '/admin/filiallar', '/tv/br_x', '/kiosk/br_x', '/offline']) {
      const res = await http().get(path).expect(200);
      expect(res.text).toContain('NYFF-SITE');
      expect(res.text).not.toContain('NYFF-APP');
    }
  });

  it('/shorva — xodimlar tizimi (SPA): ichki yo\'llar index.html, fayllar o\'zi; `/shorva` → `/shorva/`', async () => {
    const redirect = await http().get('/shorva').expect(301);
    expect(redirect.headers.location).toBe('/shorva/');
    for (const path of ['/shorva/', '/shorva/kassa', '/shorva/admin/filiallar', '/shorva/tv/br_x', '/shorva/kiosk/br_x']) {
      expect((await http().get(path).expect(200)).text).toContain('NYFF-APP');
    }
    expect((await http().get('/shorva/assets/app.js').expect(200)).text).toContain('console.log');
    // ikonkalar web ilova ichida ham (sahifa ularni `/shorva/images/icons/...` dan oladi)
    expect((await http().get('/shorva/images/icons/burger.png').expect(200)).body.toString()).toBe('ICON');
  });

  it('kategoriya ikonkalari ildizda ham (`/images/icons`, mobil ilova); yo\'q fayl — 404, sahifa emas', async () => {
    expect((await http().get('/images/icons/burger.png').expect(200)).body.toString()).toBe('ICON');
    const missing = await http().get('/images/icons/yoq.png').expect(404);
    expect(missing.text).not.toContain('NYFF-SITE');
    expect(missing.text).not.toContain('NYFF-APP');
  });

  it('API ildizda: ishlaydi; noma\'lum API yo\'li — JSON 404 (sahifa emas)', async () => {
    expect((await http().get('/api/health').expect(200)).body).toEqual({ ok: true });
    const missing = await http().get('/api/yoq').expect(404);
    expect(missing.text).not.toContain('NYFF-SITE');
    expect(missing.text).not.toContain('NYFF-APP');
  });
});
