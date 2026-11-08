import type { INestApplication } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Branch } from '../src/branches/branch.entity';
import { Setting } from '../src/database/setting.entity';
import { Product } from '../src/menu/product.entity';
import { OrdersService } from '../src/orders/orders.service';
import { ShiftsService } from '../src/shifts/shifts.service';
import { TelegramApi } from '../src/telegram/telegram.api';
import { TelegramChat } from '../src/telegram/telegram-chat.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { StockService } from '../src/warehouse/stock.service';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { seedDemo } from './fixtures/demo';
import { BRANCH_CHILONZOR as C, WAREHOUSE_CENTRAL as CENTRAL } from './fixtures/demo-data';
import { actor, createTestApp } from './test-app';

/**
 * "Kam qoldi" Telegram'da (2026-11-04): filial omborida mahsulot chegaradan pastga tushgan zahoti — ulangan admin
 * chatlariga bitta xabar (filial nomi, qoldiq, chegara); smena hisobotida — filial omborida kam qolganlar. Markaziy
 * ombor — xabarsiz. Telegram — soxta, qolgani haqiqiy.
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

const now = new Date('2026-11-04T12:00:00');
const WC = 'wh_chilonzor';
const ADMIN_CHAT = '1001';
const CASHIER_CHAT = '2002';
const BOT_KEYS = ['telegram_bot_token', 'telegram_bot'];
const cashier = actor('usr_cashier_c1', 'cashier', C);

describe('kam qoldi — Telegram', () => {
  let app: INestApplication;
  let ds: DataSource;
  let orders: OrdersService;
  let warehouse: WarehouseService;
  let branchName: string;
  const telegram = new FakeTelegram();

  const alerts = () => telegram.texts(ADMIN_CHAT).filter((text) => text.startsWith('⚠️'));
  /** xabar fonda ketadi — kelguncha (yoki 2 s) kutiladi */
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  };
  /** kelmasligini tekshirish uchun — fon ishiga vaqt beriladi */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
  const setStock = (warehouseId: string, qty: number, minQty: number) =>
    ds.manager.update(StockItem, { warehouseId, ingredientId: 'ketchup' }, { qty, minQty });
  const stockQty = async (warehouseId: string) =>
    (await ds.manager.findOneByOrFail(StockItem, { warehouseId, ingredientId: 'ketchup' })).qty;
  /** kassada naqd to'langan buyurtma — darhol oshxonaga, retsept bo'yicha ayriladi */
  const sellHotdogs = (qty: number) =>
    orders.createByCashier(cashier, { type: 'dine_in', items: [{ productId: 'hotdog-classic', qty }], payment: 'cash' }, now);
  /** [central] — markaziy ombordagi ketchup (har test boshida 10 dona) */
  const alertText = (left: string, central = '10 dona') =>
    `⚠️ ${branchName} filialida kam qolgan mahsulotlar:\n  • Ketchup — ${left} (chegara: 3 dona · markazda: ${central})`;

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(TelegramApi).useValue(telegram));
    ds = app.get(DataSource);
    orders = app.get(OrdersService);
    warehouse = app.get(WarehouseService);
  });

  beforeEach(async () => {
    await seedDemo(app, { activity: false }, now);
    branchName = (await ds.manager.findOneByOrFail(Branch, { id: C })).name;
    // hot-dog: non, sosiska, 50 g ketchup; ketchup — 600 g lik shishada, filialda chegara 3 dona (1800 g)
    await ds.manager.update(Product, 'hotdog-classic', {
      recipe: [
        { ingredientId: 'bun-hotdog', qty: 1 },
        { ingredientId: 'sausage', qty: 1 },
        { ingredientId: 'ketchup', qty: 50 },
      ],
    });
    await warehouse.saveIngredient(
      { id: 'ketchup', name: { uz: 'Ketchup', ru: 'Кетчуп', en: 'Ketchup' }, group: 'sauces', active: true, packSize: 600 },
      'admin',
    );
    await setStock(WC, 1850, 1800);
    await ds.manager.update(StockItem, { warehouseId: CENTRAL, ingredientId: 'ketchup' }, { qty: 6000 });
    await app.get(ShiftsService).openOrResume(cashier.id, C, now);
    // bot ulangan: admin chati va (admin bo'lmagan) kassir chati
    await ds.manager.upsert(Setting, [{ key: 'telegram_bot_token', value: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' }], ['key']);
    await ds.manager.insert(TelegramChat, [
      { chatId: ADMIN_CHAT, userId: 'usr_admin', username: null, name: 'Admin', linkedAt: now },
      { chatId: CASHIER_CHAT, userId: cashier.id, username: null, name: 'Kassir', linkedAt: now },
    ]);
    telegram.sent = [];
  });

  afterAll(async () => {
    await ds.manager.delete(Setting, { key: In(BOT_KEYS) });
    await app.close();
  });

  it('chegaradan tushgan zahoti — bitta xabar (faqat admin chatiga); keyingi sotuvlarda takrorlanmaydi', async () => {
    await sellHotdogs(1); // 1850 → 1800 — hali chegarada
    await settle();
    expect(alerts()).toEqual([]);

    await sellHotdogs(1); // 1800 → 1750 — chegaradan tushdi
    await until(() => alerts().length > 0);
    expect(alerts()).toEqual([alertText('2 dona + 550 g')]);
    expect(telegram.texts(CASHIER_CHAT)).toEqual([]);

    await sellHotdogs(2); // 1750 → 1650 — allaqachon kam
    await settle();
    expect(alerts()).toHaveLength(1);
  });

  it("to'ldirilgach yana tushsa — yana xabar; markaziy omborda tushsa — xabar yo'q", async () => {
    await setStock(CENTRAL, 2000, 1800);
    // markazdan filialga 1 dona: markaz 2000 → 1400 (chegaradan tushdi — lekin markaziy), filial 1850 → 2450
    await warehouse.createTransfer(
      { fromWarehouseId: CENTRAL, toWarehouseId: WC, items: [{ ingredientId: 'ketchup', qty: 1 }] },
      'usr_supplier',
      now,
    );
    await settle();
    expect(alerts()).toEqual([]);

    await sellHotdogs(13); // 2450 → 1800 — chegarada
    await settle();
    expect(alerts()).toEqual([]);
    await sellHotdogs(1); // 1800 → 1750
    await until(() => alerts().length > 0);
    expect(alerts()).toEqual([alertText('2 dona + 550 g', '2 dona + 200 g')]);

    // filialdan filialga ko'chirish ham — chiqim bergan filial uchun
    await setStock(WC, 1900, 1800);
    telegram.sent = [];
    await warehouse.createTransfer(
      { fromWarehouseId: WC, toWarehouseId: 'wh_yunusobod', items: [{ ingredientId: 'ketchup', qty: 1 }] },
      'usr_supplier',
      now,
    );
    await until(() => alerts().length > 0);
    expect(alerts()).toEqual([alertText('2 dona + 100 g', '2 dona + 200 g')]);

    // markazda ham tugagan — "yo'q"
    await setStock(WC, 1850, 1800);
    await ds.manager.update(StockItem, { warehouseId: CENTRAL, ingredientId: 'ketchup' }, { qty: 0 });
    telegram.sent = [];
    await sellHotdogs(2);
    await until(() => alerts().length > 0);
    expect(alerts()).toEqual([alertText('2 dona + 550 g', "yo'q")]);
  });

  it("tranzaksiya bekor bo'lsa (ROLLBACK) — xabar yo'q; bot ulanmagan bo'lsa — sotuv baribir o'tadi", async () => {
    await expect(
      ds.transaction(async (em) => {
        await app.get(StockService).applyDeltas(em, WC, [{ ingredientId: 'ketchup', qty: -200 }], 'sale', 'ord_x', now);
        throw new Error('bekor');
      }),
    ).rejects.toThrow('bekor');
    await settle();
    expect(alerts()).toEqual([]);
    expect(await stockQty(WC)).toBe(1850);

    await ds.manager.delete(Setting, { key: 'telegram_bot_token' });
    await sellHotdogs(2); // 1850 → 1750
    await settle();
    expect(telegram.sent).toEqual([]);
    expect(await stockQty(WC)).toBe(1750);
  });

  it('bir vaqtda ikki sotuv chegaradan tushirsa — xabar bir marta', async () => {
    await Promise.all([sellHotdogs(2), sellHotdogs(2)]); // 1850 → 1750 → 1650: faqat bittasi tushirgan
    await until(() => alerts().length > 0);
    await settle();
    expect(alerts()).toHaveLength(1);
    expect(await stockQty(WC)).toBe(1650);
    // qoldiq — xabar yuborilgan paytdagisi (ikkinchi sotuv tugagan-tugamaganiga qarab)
    expect([alertText('2 dona + 550 g'), alertText('2 dona + 450 g')]).toContain(alerts()[0]);
  });

  it("smena yopilganda — hisobotda filial omborida kam qolganlarning hammasi (oldindan kam bo'lganlari ham)", async () => {
    await sellHotdogs(2); // ketchup chegaradan tushdi
    await until(() => alerts().length > 0);
    const shift = await app.get(ShiftsService).openOrResume(cashier.id, C, now);
    await app.get(ShiftsService).close(shift.id, now, cashier);
    await until(() => telegram.texts(ADMIN_CHAT).some((text) => text.startsWith('Smena yopildi')));
    const report = telegram.texts(ADMIN_CHAT).find((text) => text.startsWith('Smena yopildi'))!;
    const section = report.split('\n\n').find((part) => part.startsWith('Omborda kam qolgan:'));
    // demo: Chilonzor'da chedder (1,5 kg / 2 kg), kimchi (0,9 kg / 1,5 kg), kola (30 / 48) — oldindan kam;
    // markazdagi qoldig'i ham yoziladi (demo sonlari — tekshirilmaydi, ketchup — 10 dona)
    const lines = section?.split('\n') ?? [];
    expect(lines.every((line, i) => i === 0 || line.includes(' · markazda: '))).toBe(true);
    expect(lines).toContain('  • Ketchup — 2 dona + 550 g (chegara: 3 dona · markazda: 10 dona)');
    expect(lines.map((line) => line.replace(/ · markazda: [^)]*/, ''))).toEqual([
      'Omborda kam qolgan:',
      '  • Coca-Cola 0,5 l — 30 dona (chegara: 48 dona)',
      '  • Ketchup — 2 dona + 550 g (chegara: 3 dona)',
      '  • Kimchi — 0,9 kg (chegara: 1,5 kg)',
      '  • Pishloq (chedder) — 1,5 kg (chegara: 2 kg)',
    ]);
  });
});
