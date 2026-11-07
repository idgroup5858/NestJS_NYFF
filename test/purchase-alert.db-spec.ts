import type { INestApplication } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Branch } from '../src/branches/branch.entity';
import { Setting } from '../src/database/setting.entity';
import { TelegramApi } from '../src/telegram/telegram.api';
import { TelegramChat } from '../src/telegram/telegram-chat.entity';
import { Purchase } from '../src/warehouse/purchase.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { BRANCH_CHILONZOR as C, WAREHOUSE_CENTRAL as CENTRAL } from './fixtures/demo-data';
import { createTestApp, expectCode } from './test-app';

/**
 * "Yangi kirim" Telegram'da (2026-11-08): admin tasdiqlamaydi — kirim darhol omborga qo'shiladi va ulangan admin
 * chatlariga xabar ketadi: nima, qancha, 1 birlik narxi, qator summasi va kirim summasi. Telegram — soxta.
 */

class FakeTelegram {
  sent: { method: string; params: Record<string, unknown> }[] = [];

  async call<T>(_token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.sent.push({ method, params });
    return true as T;
  }

  texts(chatId: string): string[] {
    return this.sent
      .filter((s) => s.method === 'sendMessage' && s.params.chat_id === chatId)
      .map((s) => String(s.params.text));
  }
}

const now = new Date('2026-11-08T14:32:00');
const WC = 'wh_chilonzor';
const ADMIN_CHAT = '1001';
const SUPPLIER_CHAT = '3003';
const BOT_KEYS = ['telegram_bot_token', 'telegram_bot'];

describe('yangi kirim — Telegram', () => {
  let app: INestApplication;
  let ds: DataSource;
  let warehouse: WarehouseService;
  const telegram = new FakeTelegram();

  const notices = () => telegram.texts(ADMIN_CHAT).filter((text) => text.startsWith('📦'));
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
  const stockQty = async (warehouseId: string, ingredientId: string) =>
    (await ds.manager.findOneBy(StockItem, { warehouseId, ingredientId }))?.qty ?? 0;

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(TelegramApi).useValue(telegram));
    ds = app.get(DataSource);
    warehouse = app.get(WarehouseService);
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
    await warehouse.saveIngredient(
      { id: 'ketchup', name: { uz: 'Ketchup', ru: 'Кетчуп', en: 'Ketchup' }, group: 'sauces', active: true, packSize: 600 },
      'admin',
    );
    // bot ulangan: admin chati va (admin bo'lmagan) ta'minotchi chati
    await ds.manager.upsert(Setting, [{ key: 'telegram_bot_token', value: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' }], ['key']);
    await ds.manager.insert(TelegramChat, [
      { chatId: ADMIN_CHAT, userId: 'usr_admin', username: null, name: 'Admin', linkedAt: now },
      { chatId: SUPPLIER_CHAT, userId: 'usr_supplier', username: null, name: "Ta'minotchi", linkedAt: now },
    ]);
    telegram.sent = [];
  });

  afterAll(async () => {
    await ds.manager.delete(Setting, { key: In(BOT_KEYS) });
    await app.close();
  });

  it("ta'minotchi kirimi — darhol omborga va admin chatiga: mahsulot, miqdor, 1 birlik narxi, summalar", async () => {
    const tomato0 = await stockQty(CENTRAL, 'tomato');
    const purchase = await warehouse.createPurchase(
      {
        warehouseId: CENTRAL,
        items: [
          { ingredientId: 'tomato', qty: 12.5, price: 15000 },
          { ingredientId: 'ketchup', qty: 10, price: 17000 },
          { ingredientId: 'napkin', qty: 1000, price: 50 },
        ],
        note: 'Bozordan',
      },
      'usr_supplier',
      now,
    );
    expect(await stockQty(CENTRAL, 'tomato')).toBe(tomato0 + 12500);

    await until(() => notices().length > 0);
    expect(notices()).toEqual([
      [
        `📦 Yangi kirim №${purchase.number}`,
        'Ombor: Markaziy ombor',
        'Kiritdi: Bekzod Rahimov · 08.11.2026 14:32',
        '',
        '• Pomidor — 12,5 kg',
        "   1 kg narxi: 15 000 so'm · jami: 187 500 so'm",
        '• Ketchup — 10 dona (1 dona = 600 g)',
        "   1 dona narxi: 17 000 so'm · jami: 170 000 so'm",
        '• Salfetka — 1 000 dona',
        "   1 dona narxi: 50 so'm · jami: 50 000 so'm",
        '',
        "Kirim summasi: 407 500 so'm",
        'Izoh: Bozordan',
      ].join('\n'),
    ]);
    // admin bo'lmagan chatga — yo'q
    expect(telegram.texts(SUPPLIER_CHAT)).toEqual([]);
  });

  it("admin kiritsa ham xabar; filial ombori — filial nomi bilan; izohsiz", async () => {
    const branchName = (await ds.manager.findOneByOrFail(Branch, { id: C })).name;
    await warehouse.createPurchase({ warehouseId: WC, items: [{ ingredientId: 'tomato', qty: 3 }] }, 'usr_admin', now);
    await until(() => notices().length > 0);
    expect(notices()).toHaveLength(1);
    const lines = notices()[0].split('\n');
    expect(lines.slice(1, 3)).toEqual([`Ombor: ${branchName} ombori`, 'Kiritdi: Admin Adminov · 08.11.2026 14:32']);
    // narx yozilmadi — oxirgi narx (14 000)
    expect(lines.slice(4)).toEqual(['• Pomidor — 3 kg', "   1 kg narxi: 14 000 so'm · jami: 42 000 so'm", '', "Kirim summasi: 42 000 so'm"]);
  });

  it("xato kirim — xabar ham, qoldiq ham yo'q; bot ulanmagan bo'lsa — kirim baribir saqlanadi", async () => {
    const tomato0 = await stockQty(CENTRAL, 'tomato');
    await expectCode('invalid_price', () =>
      warehouse.createPurchase(
        { warehouseId: CENTRAL, items: [{ ingredientId: 'tomato', qty: 2, price: 1.5 }] },
        'usr_supplier',
        now,
      ),
    );
    await settle();
    expect(notices()).toEqual([]);
    expect(await stockQty(CENTRAL, 'tomato')).toBe(tomato0);

    await ds.manager.delete(Setting, { key: 'telegram_bot_token' });
    await warehouse.createPurchase(
      { warehouseId: CENTRAL, items: [{ ingredientId: 'tomato', qty: 2, price: 15000 }] },
      'usr_supplier',
      now,
    );
    await settle();
    expect(telegram.sent).toEqual([]);
    expect(await stockQty(CENTRAL, 'tomato')).toBe(tomato0 + 2000);
    expect(await ds.manager.countBy(Purchase, { status: 'approved' })).toBe(1);
  });
});
