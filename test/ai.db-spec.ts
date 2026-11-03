import type { INestApplication } from '@nestjs/common';
import type { FunctionCall, FunctionResponse } from '@google/genai';
import { execFile } from 'node:child_process';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import { DataSource, Not, IsNull, Between } from 'typeorm';
import { AiMessage } from '../src/ai/ai-message.entity';
import { AiService } from '../src/ai/ai.service';
import { AiTools } from '../src/ai/ai.tools';
import { GeminiClient, type GeminiReply, type GeminiRequest } from '../src/ai/gemini.client';
import { AuthService } from '../src/auth/auth.service';
import { hashPin } from '../src/auth/pin';
import { BackupService, PART_BYTES, pgDumpPath } from '../src/backup/backup.service';
import { Setting } from '../src/database/setting.entity';
import { Branch } from '../src/branches/branch.entity';
import { Warehouse } from '../src/branches/warehouse.entity';
import { addDays, dateKey } from '../src/domain/dates';
import { fromBase } from '../src/domain/units';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN } from './fixtures/demo-data';
import { Expense } from '../src/expenses/expense.entity';
import { Category } from '../src/menu/category.entity';
import { Product } from '../src/menu/product.entity';
import { Order } from '../src/orders/order.entity';
import { ReportsService } from '../src/reports/reports.service';
import { BOT_COMMANDS, COMMANDS_HELP } from '../src/telegram/commands';
import { som } from '../src/telegram/format';
import { TelegramApi, TelegramApiError, type TgUpdate, type TgUpload } from '../src/telegram/telegram.api';
import { TelegramService } from '../src/telegram/telegram.service';
import { fullName, User } from '../src/users/user.entity';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { WAITING } from '../src/ai/waiting';
import { GREETING, IDENTITY_ANSWER } from '../src/ai/xorazm';
import { actor, createTestApp } from './test-app';

/** Gemini soxtasi: har chaqiruvga stsenariydagi navbatdagi javob; so'rovlar (o'sha paytdagi surati) yoziladi. */
class FakeGemini {
  model = 'fake-model';
  configured = true;
  requests: GeminiRequest[] = [];
  script: (() => GeminiReply)[] = [];

  /** shevaga o'girish (2-so'rov): standart — matn o'zgarmaydi */
  rewrites: { system: string; text: string }[] = [];
  dialect: (text: string) => string = (text) => text;

  async generate(request: GeminiRequest): Promise<GeminiReply> {
    this.requests.push({ ...request, contents: structuredClone(request.contents) });
    const step = this.script.shift();
    if (!step) throw new Error('stsenariy tugadi');
    return step();
  }

  async rewrite(system: string, text: string): Promise<string> {
    this.rewrites.push({ system, text });
    return this.dialect(text);
  }

  /** ovoz → matn: eshitilgan matn sozlanadi */
  transcripts: { system: string; audio: Buffer; mimeType: string }[] = [];
  heard = '';

  async transcribe(system: string, audio: Buffer, mimeType: string): Promise<string> {
    this.transcripts.push({ system, audio, mimeType });
    return this.heard;
  }
}

const say =
  (text: string) =>
  (): GeminiReply => ({ content: { role: 'model', parts: [{ text }] }, functionCalls: [], text });
const calls =
  (...functionCalls: FunctionCall[]) =>
  (): GeminiReply => ({
    content: { role: 'model', parts: functionCalls.map((functionCall) => ({ functionCall })) },
    functionCalls,
    text: '',
  });

/** Telegram soxtasi: yuborilganlar yoziladi, `getMe` javobi sozlanadi. */
class FakeTelegram {
  sent: { method: string; params: Record<string, unknown> }[] = [];
  getMe: () => unknown = () => ({ id: 777, is_bot: true, first_name: 'NYFF', username: 'nyff_test_bot' });

  async call<T>(_token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (method === 'getMe') return this.getMe() as T;
    this.sent.push({ method, params });
    return true as T;
  }

  /** ovozli xabar fayli */
  async download(_token: string, fileId: string): Promise<Buffer> {
    return Buffer.from(`OggS:${fileId}`);
  }

  async upload<T>(_token: string, method: string, fields: Record<string, string>, file: TgUpload): Promise<T> {
    this.sent.push({ method, params: { ...fields, file } });
    return true as T;
  }

  texts(chatId: string): string[] {
    return this.sent
      .filter((s) => s.method === 'sendMessage' && s.params.chat_id === chatId)
      .map((s) => String(s.params.text));
  }

  last(chatId: string): string {
    return this.texts(chatId).at(-1) ?? '';
  }
}

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const OTHER_BOT_TOKEN = '987654321:AAFfOtherBotTokenForTestsOnly_0123456';

/**
 * AI yordamchi va Telegram bot: Gemini va Telegram — soxta, qolgani haqiqiy (baza, servislar, HTTP). Ma'lumot — demo
 * (buyurtmalar tarixi bilan).
 */
describe('AI yordamchi', () => {
  let app: INestApplication;
  const gemini = new FakeGemini();
  const telegram = new FakeTelegram();
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (user: string) => ({ Authorization: `Bearer ${tokens[user]}` });
  const today = dateKey(new Date());
  let tools: AiTools;
  let db: DataSource;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(GeminiClient).useValue(gemini).overrideProvider(TelegramApi).useValue(telegram),
    );
    await seedDemo(app, { activity: true });
    db = app.get(DataSource);
    tools = app.get(AiTools);
    await db.manager.insert(User, {
      id: 'usr_admin2',
      name: 'Direktor',
      surname: 'Karimov',
      role: 'admin',
      branchIds: [],
      email: 'direktor@gmail.com',
      pinHash: await hashPin('direktor99'),
      failedPinAttempts: 0,
      pinLockedUntil: null,
      active: true,
      onDuty: false,
      createdAt: new Date(),
    });
    for (const [user, email, password] of [
      ['usr_admin', ADMIN_LOGIN.email, ADMIN_LOGIN.password],
      ['usr_admin2', 'direktor@gmail.com', 'direktor99'],
    ]) {
      tokens[user] = (await http().post('/api/auth/admin-login').send({ email, password }).expect(200)).body.token;
    }
    // kassir kirganda Chilonzor'da smena ochiladi
    tokens.usr_cashier_c1 = (
      await http().post('/api/auth/login').send({ userId: 'usr_cashier_c1', pin: '1234' }).expect(200)
    ).body.token;
  });

  beforeEach(() => {
    gemini.configured = true;
    gemini.requests = [];
    gemini.script = [];
    gemini.rewrites = [];
    gemini.dialect = (text) => text;
    gemini.transcripts = [];
    gemini.heard = '';
    telegram.sent = [];
  });

  afterAll(() => app.close());

  /** Bazada qolgan xabarlar, eskisi birinchi: [rol, matn]. */
  const stored = async (chat = 'web', userId = 'usr_admin') =>
    (await db.manager.find(AiMessage, { where: { userId, chat }, order: { createdAt: 'ASC', id: 'ASC' } })).map(
      (m) => [m.role, m.text],
    );

  describe('chat', () => {
    beforeEach(() => db.manager.clear(AiMessage));

    it("tool'lar bajariladi (parallel, id bilan), javob — oddiy matn; savol va javob saqlanadi", async () => {
      gemini.script = [
        calls(
          { id: 'c1', name: 'sales_report', args: { from: today, to: today } },
          { id: 'c2', name: 'current_status', args: {} },
        ),
        say("**Bugun** tushum:\n- 100 000 so'm"),
      ];
      const res = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: '  Bugungi tushum?  ' }).expect(201);
      expect(res.body.question).toMatchObject({ role: 'user', text: 'Bugungi tushum?', chat: 'web' });
      expect(res.body.answer).toMatchObject({ role: 'model', text: "Bugun tushum:\n• 100 000 so'm" });

      expect(gemini.requests).toHaveLength(2);
      expect(gemini.requests[0].system).toContain(`Now: ${today}`);
      expect(gemini.requests[0].system).toContain('br_chilonzor — ');
      expect(gemini.requests[0].tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(['sales_report', 'current_status', 'shifts', 'expenses', 'purchases', 'stock', 'orders', 'menu']),
      );
      const second = gemini.requests[1].contents;
      expect(second.at(-2)?.role).toBe('model');
      const responses = second.at(-1)!.parts!.map((part) => part.functionResponse as FunctionResponse);
      expect(responses.map((r) => [r.id, r.name])).toEqual([
        ['c1', 'sales_report'],
        ['c2', 'current_status'],
      ]);
      const report = await app.get(ReportsService).sales({ from: today, to: today, branchId: null });
      expect(responses[0].response).toMatchObject({ output: { revenue: report.revenue, orders: report.orders } });

      // kunning birinchi savoli: savol → salom → javob (bazada — AI xotirasi uchun)
      expect(res.body.greeting).toMatchObject({ role: 'model', text: GREETING });
      expect(await stored()).toEqual([
        ['user', 'Bugungi tushum?'],
        ['model', GREETING],
        ['model', res.body.answer.text],
      ]);
      // boshqa adminning suhbati alohida
      expect(await stored('web', 'usr_admin2')).toEqual([]);
    });

    it("keyingi savolga oldingi suhbat qo'shiladi; sahifa ochilganda yangi suhbat — eskisi o'chadi, Telegram'niki qoladi", async () => {
      gemini.script = [say('Birinchi javob'), say('Ikkinchi javob')];
      await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'Bugun-chi?' }).expect(201);
      await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'Kecha-chi?' }).expect(201);
      const contents = gemini.requests[1].contents;
      expect(contents.map((c) => [c.role, c.parts?.[0].text])).toEqual([
        ['user', 'Bugun-chi?'],
        ['model', 'Birinchi javob'],
        ['user', 'Kecha-chi?'],
      ]);

      await app.get(AiService).newChat('usr_admin', 'tg:555');
      const started = await http().post('/api/ai/chat').set(as('usr_admin')).expect(201);
      expect(started.body).toMatchObject({ configured: true, greeting: { role: 'model', chat: 'web', text: GREETING } });
      expect(await stored()).toEqual([['model', GREETING]]);
      expect(await stored('tg:555')).toEqual([['model', GREETING]]);
      // tarix endi ko'rsatilmaydi
      await http().get('/api/ai/messages').set(as('usr_admin')).expect(404);
    });

    it("kassir — 403; kalit yo'q — ai_not_configured; Gemini xatosi — ai_failed, hech narsa saqlanmaydi", async () => {
      await http().post('/api/ai/messages').set(as('usr_cashier_c1')).send({ text: 'Tushum?' }).expect(403);
      await http().get('/api/telegram').set(as('usr_cashier_c1')).expect(403);

      gemini.configured = false;
      const off = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'Tushum?' }).expect(503);
      expect(off.body.code).toBe('ai_not_configured');
      expect((await http().post('/api/ai/chat').set(as('usr_admin')).expect(201)).body.configured).toBe(false);
      await http().post('/api/ai/chat').set(as('usr_cashier_c1')).expect(403);
      // kutish matni — savol turiga qarab (AI'siz, kalit yo'q bo'lsa ham)
      const waiting = await http().post('/api/ai/waiting').set(as('usr_admin')).send({ text: 'Bugungi tushum?' }).expect(200);
      expect(waiting.body).toEqual({ text: WAITING.money });
      await http().post('/api/ai/waiting').set(as('usr_cashier_c1')).send({ text: 'Tushum?' }).expect(403);

      gemini.configured = true;
      const before = await db.manager.count(AiMessage);
      gemini.script = [
        () => {
          throw new Error('quota exceeded');
        },
      ];
      const failed = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'Tushum?' }).expect(502);
      expect(failed.body.code).toBe('ai_failed');
      expect(await db.manager.count(AiMessage)).toBe(before);

      const empty = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: '   ' }).expect(400);
      expect(empty.body.code).toBe('invalid_input');
    });

    it("salom: har chatda kuniga bir marta (kunning birinchi savolida), yangi suhbatda — darhol; modelga yuborilmaydi", async () => {
      const ask = (text: string) => http().post('/api/ai/messages').set(as('usr_admin')).send({ text }).expect(201);
      gemini.script = ['Birinchi', 'Ikkinchi', 'Uchinchi', "To'rtinchi", 'Beshinchi'].map((text) => say(text));

      expect((await ask('Bugun?')).body.greeting).toMatchObject({ role: 'model', text: GREETING });
      expect((await ask('Kecha?')).body.greeting).toBeNull();
      // salom suhbat tarixida, lekin modelga bormaydi
      expect(gemini.requests[1].contents.map((c) => c.parts?.[0].text)).toEqual(['Bugun?', 'Birinchi', 'Kecha?']);

      // ertasi kun: oxirgi salom kechagi — yana salom
      await db.manager.update(AiMessage, { userId: 'usr_admin', chat: 'web', text: GREETING }, {
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      });
      expect((await ask('Bugun-chi?')).body.greeting).toMatchObject({ text: GREETING });
      // Telegram chati — alohida hisob
      const tg = await app.get(AiService).ask(actor('usr_admin', 'admin'), 'tg:777', 'Salom');
      expect(tg.greeting).toMatchObject({ chat: 'tg:777', text: GREETING });

      // yangi suhbat: tarix o'rniga salom, keyingi savolda takrorlanmaydi
      await http().post('/api/ai/chat').set(as('usr_admin')).expect(201);
      expect((await ask('Yana?')).body.greeting).toBeNull();
      expect(await stored()).toEqual([
        ['model', GREETING],
        ['user', 'Yana?'],
        ['model', 'Beshinchi'],
      ]);
    });

    it("javob Xorazm shevasiga 2-so'rov bilan o'giriladi; u xato bersa — adabiy javob (yo'qolmaydi)", async () => {
      gemini.script = [say('Bugungi tushum 0 so\'m edi.')];
      gemini.dialect = (text) => text.replace('Bugungi', 'Bugunki').replace('edi', 'adi');
      const res = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'bugunki tushum nichcha?' }).expect(201);
      expect(res.body.answer.text).toBe("Bugunki tushum 0 so'm adi.");
      expect(gemini.rewrites).toEqual([{ system: expect.stringContaining('Khorezm dialect'), text: "Bugungi tushum 0 so'm edi." }]);
      // 1-so'rov: adabiy yozadi, shevadagi savolni lug'at bilan tushunadi (sheva → adabiy)
      expect(gemini.requests[0].system).toContain('converted to the Khorezm dialect afterwards');
      expect(gemini.requests[0].system).toContain('• nichcha → nechta');
      // xotirada — adabiy javob (model keyingisini ham adabiy yozsin), web'ga — shevada
      expect((await stored()).at(-1)).toEqual(['model', "Bugungi tushum 0 so'm edi."]);

      gemini.script = [say("Kechagi tushum 385 000 so'm.")];
      gemini.dialect = () => {
        throw new Error('quota exceeded');
      };
      const fallback = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'kecha-chi?' }).expect(201);
      expect(fallback.body.answer.text).toBe("Kechagi tushum 385 000 so'm.");
    });

    it("kimlik jumlasi shevaga o'girishga yuborilmaydi — javob boshida o'zgarishsiz", async () => {
      gemini.script = [say(`${IDENTITY_ANSWER} Bugungi tushum 0 so'm edi.`), say("Bugungi tushum 0 so'm edi.")];
      gemini.dialect = (text) => text.replace('Bugungi', 'Bugunki').replace('edi', 'adi');
      const res = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'Sen kimsan, tushum qancha?' }).expect(201);
      expect(res.body.answer.text).toBe(`${IDENTITY_ANSWER}\nBugunki tushum 0 so'm adi.`);
      expect(gemini.rewrites.map((r) => r.text)).toEqual(["Bugungi tushum 0 so'm edi."]);
      // jumlasiz javobga qo'shilmaydi
      const plain = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'Tushum?' }).expect(201);
      expect(plain.body.answer.text).toBe("Bugunki tushum 0 so'm adi.");
    });

    it("bazada faqat AI xotirasi qoladi: oxirgi 20 ta xabar va bugungi salom; kechagi salom o'chadi", async () => {
      const service = app.get(AiService);
      // vaqt oldinga — har savol oldingi javobdan keyin turishi aniq bo'lsin (tez testda millisekund bir xil bo'lmasin)
      const base = Date.now() + 1000;
      await service.newChat('usr_admin', 'tg:900', new Date(base - 86_400_000));
      gemini.script = Array.from({ length: 12 }, (_, i) => say(`Javob ${i}`));
      for (let i = 0; i < 12; i++) {
        await service.ask(actor('usr_admin', 'admin'), 'tg:900', `Savol ${i}`, new Date(base + i * 1000));
      }
      const rows = await stored('tg:900');
      expect(rows.filter(([, text]) => text === GREETING)).toHaveLength(1);
      const memory = rows.filter(([, text]) => text !== GREETING);
      expect(memory).toHaveLength(20);
      expect(memory[0]).toEqual(['user', 'Savol 2']);
      expect(memory.at(-1)).toEqual(['model', 'Javob 11']);
      // oxirgi savolda modelga: oldingi 20 ta xabar + savolning o'zi
      expect(gemini.requests.at(-1)!.contents).toHaveLength(21);
    });

    it("model to'xtamasa (6 bosqichdan ko'p tool) — ai_failed", async () => {
      gemini.script = Array.from({ length: 6 }, () => calls({ id: 'x', name: 'current_status', args: {} }));
      const res = await http().post('/api/ai/messages').set(as('usr_admin')).send({ text: 'Holat?' }).expect(502);
      expect(res.body.code).toBe('ai_failed');
    });
  });

  describe("tool'lar", () => {
    it("noto'g'ri argument — modelga xato matni (so'rov yiqilmaydi)", async () => {
      expect(await tools.run('sales_report', { from: '2026-02-30', to: '2026-03-01' })).toEqual({
        error: expect.stringContaining('from'),
      });
      expect(await tools.run('sales_report', { from: '2026-10-02', to: '2026-10-01' })).toEqual({
        error: 'from must not be after to',
      });
      expect(await tools.run('orders', { from: today, to: today, branchId: 'br_yoq' })).toEqual({
        error: expect.stringContaining('br_chilonzor'),
      });
      expect(await tools.run('orders', { from: today, to: today, status: 'done' })).toEqual({
        error: expect.stringContaining('pending'),
      });
      expect(await tools.run('yoq', {})).toEqual({ error: 'unknown tool: yoq' });
    });

    it("sotuv: hisobot bilan bir xil, filial nomlari; uzun davr — oylar bo'yicha", async () => {
      const service = app.get(ReportsService);
      const from = addDays(today, -6);
      const week = (await tools.run('sales_report', { from, to: today })) as { output: Record<string, any> };
      const report = await service.sales({ from, to: today, branchId: null });
      expect(week.output).toMatchObject({ revenue: report.revenue, net: report.net, byType: report.byType });
      expect(week.output.days).toHaveLength(7);
      const branches = await db.manager.find(Branch);
      expect(week.output.byBranch.map((b: { branch: string }) => b.branch).sort()).toEqual(
        branches.map((b) => b.name).sort(),
      );
      // sotilganlar + sotilmaganlar = butun faol menyu (takrorsiz)
      const menu = await db.manager.find(Product, { where: { active: true } });
      const listed = [...week.output.products.map((p: { name: string }) => p.name), ...week.output.notSold];
      expect(listed.sort()).toEqual(menu.map((p) => p.name.uz).sort());

      const long = (await tools.run('sales_report', { from: addDays(today, -200), to: today })) as {
        output: Record<string, any>;
      };
      expect(long.output.days).toBeUndefined();
      const months = long.output.months as { revenue: number }[];
      expect(months.reduce((sum, m) => sum + m.revenue, 0)).toBe(long.output.revenue);
    });

    it("ombor: kam qolganlar o'z birligida; hozirgi holat — ochiq smena va kassir", async () => {
      const low = (await tools.run('stock', { lowOnly: true })) as {
        output: { items: { warehouse: string; name: string; qty: number; unit: string; status: string }[] };
      };
      const ingredients = new Map((await db.manager.find(Ingredient)).map((i) => [i.id, i]));
      const branches = new Map((await db.manager.find(Branch)).map((b) => [b.id, b.name]));
      const branchName = branches.get('br_chilonzor')!;
      const warehouses = new Map(
        (await db.manager.find(Warehouse)).map((w) => [
          w.id,
          w.kind === 'central' ? 'Markaziy ombor' : `${branches.get(w.branchId!)} ombori`,
        ]),
      );
      const expected = await app.get(WarehouseService).lowStock();
      expect(expected.length).toBeGreaterThan(0);
      for (const row of expected) {
        const item = ingredients.get(row.ingredientId)!;
        expect(low.output.items).toContainEqual(
          expect.objectContaining({
            warehouse: warehouses.get(row.warehouseId),
            name: item.name.uz,
            qty: Math.round(fromBase(row.qty, item.unit) * 1000) / 1000,
            unit: { kg: 'kg', l: 'l', pcs: 'dona' }[item.unit],
            status: row.qty <= 0 ? 'out' : 'low',
          }),
        );
      }
      expect(low.output.items.every((i) => i.status !== 'ok')).toBe(true);

      // filial qayta nomlansa — ombor ham yangi nomi bilan (bazadagi `warehouses.name` eskicha qoladi), web'dagidek
      await db.manager.update(Branch, 'br_chilonzor', { name: 'Luchvoy' });
      try {
        const renamed = (await tools.run('stock', { warehouseId: 'wh_chilonzor' })) as { output: { items: { warehouse: string }[] } };
        expect(renamed.output.items.length).toBeGreaterThan(0);
        expect(renamed.output.items.every((i) => i.warehouse === 'Luchvoy ombori')).toBe(true);
        const purchases = JSON.stringify(await tools.run('purchases', { from: addDays(today, -60), to: today }));
        expect(purchases).not.toContain('Chilonzor ombori');
        expect((await tools.directory()).warehouses).toEqual(
          expect.arrayContaining([
            { id: 'wh_central', name: 'Markaziy ombor' },
            { id: 'wh_chilonzor', name: 'Luchvoy ombori' },
          ]),
        );
      } finally {
        await db.manager.update(Branch, 'br_chilonzor', { name: branchName });
      }
      const cheese = (await tools.run('stock', { search: 'cheddar' })) as { output: { items: { name: string }[] } };
      expect(cheese.output.items.length).toBeGreaterThan(0);
      expect(cheese.output.items.every((i) => i.name === 'Pishloq (chedder)')).toBe(true);

      const status = (await tools.run('current_status', {})) as {
        output: { branches: { id: string; working: boolean; cashiersOnShift: string[] }[] };
      };
      expect(status.output.branches.find((b) => b.id === 'br_chilonzor')).toMatchObject({
        working: true,
        cashiersOnShift: expect.arrayContaining(['Dilnoza Karimova']),
      });
    });

    it("menyu: kategoriyalar tartibida, narx bilan; filialda sotilmaydigani belgilangan; o'chirilgani alohida", async () => {
      const product = (await db.manager.findOneByOrFail(Product, { id: 'tea' }));
      await db.manager.update(Product, 'tea', { unavailableBranchIds: ['br_yunusobod'] });
      await db.manager.update(Product, 'burger-classic', { active: false });
      try {
        const menu = (await tools.run('menu', {})) as {
          output: { categories: { name: string; products: { name: string; price: number; notSoldAt?: string[] }[] }[]; offMenu: string[] };
        };
        const categories = await db.manager.find(Category, { where: { active: true }, order: { sortOrder: 'ASC' } });
        const shown = menu.output.categories.map((c) => c.name);
        expect(shown).toEqual(categories.map((c) => c.name.uz).filter((name) => shown.includes(name)));
        const items = menu.output.categories.flatMap((c) => c.products);
        const yunusobod = (await db.manager.findOneByOrFail(Branch, { id: 'br_yunusobod' })).name;
        expect(items).toContainEqual({ name: product.name.uz, price: product.price, notSoldAt: [yunusobod] });
        const burger = (await db.manager.findOneByOrFail(Product, { id: 'burger-classic' })).name.uz;
        expect(items.map((p) => p.name)).not.toContain(burger);
        expect(menu.output.offMenu).toContain(burger);
        expect(items.length + menu.output.offMenu.length).toBe(await db.manager.count(Product));
      } finally {
        await db.manager.update(Product, 'tea', { unavailableBranchIds: product.unavailableBranchIds });
        await db.manager.update(Product, 'burger-classic', { active: true });
      }
    });

    it("buyurtmalarda mijoz ismi, telefoni va manzili yo'q; chiqimlar jami bazadagidek", async () => {
      const from = addDays(today, -30);
      const mobile = await db.manager.find(Order, { where: { online: Not(IsNull()) }, take: 200 });
      expect(mobile.length).toBeGreaterThan(0);
      const result = JSON.stringify(await tools.run('orders', { from, to: today, source: 'mobile' }));
      expect(result).toContain('"output"');
      for (const order of mobile) {
        expect(result).not.toContain(order.online!.phone);
        if (order.online!.address) expect(result).not.toContain(order.online!.address);
      }

      const expenses = (await tools.run('expenses', { from, to: today })) as { output: { total: number } };
      const rows = await db.manager.find(Expense, { where: { date: Between(from, today) } });
      expect(expenses.output.total).toBe(rows.reduce((sum, e) => sum + e.amount, 0));
    });
  });

  describe('Telegram', () => {
    const service = () => app.get(TelegramService);
    const message = (chatId: number, text: string, type: 'private' | 'group' = 'private'): TgUpdate => ({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: chatId, type },
        from: { id: chatId, is_bot: false, first_name: 'Direktor', last_name: 'Aka', username: 'boss' },
        text,
      },
    });
    const send = (chatId: number, text: string) => service().handleUpdate(BOT_TOKEN, message(chatId, text));
    /** ovozli xabar ([duration] soniya) */
    const sendVoice = (chatId: number, duration: number) => {
      const { text: _text, ...rest } = message(chatId, '').message!;
      return service().handleUpdate(BOT_TOKEN, {
        update_id: 2,
        message: { ...rest, voice: { file_id: `voice-${chatId}`, duration, mime_type: 'audio/ogg' } },
      });
    };
    const linkOf = async (user: string) =>
      (await http().get('/api/telegram').set(as(user)).expect(200)).body.link as string;
    const codeOf = (link: string) => link.split('start=')[1];

    // bot tokeni `settings` da — demo tiklash tozalamaydi (oldingi yiqilgan ishga tushirishdan qolmasin)
    beforeAll(() => service().disconnect());

    afterEach(() => {
      telegram.getMe = () => ({ id: 777, is_bot: true, first_name: 'NYFF', username: 'nyff_test_bot' });
    });

    it("token: shakli noto'g'ri yoki getMe rad etsa — telegram_token_invalid; tarmoq — telegram_unreachable", async () => {
      const bad = await http().put('/api/telegram/token').set(as('usr_admin')).send({ token: 'abc/def' }).expect(400);
      expect(bad.body.code).toBe('telegram_token_invalid');

      telegram.getMe = () => {
        throw new TelegramApiError(401, 'Unauthorized');
      };
      const rejected = await http().put('/api/telegram/token').set(as('usr_admin')).send({ token: BOT_TOKEN }).expect(400);
      expect(rejected.body.code).toBe('telegram_token_invalid');

      telegram.getMe = () => {
        throw new TypeError('fetch failed');
      };
      const offline = await http().put('/api/telegram/token').set(as('usr_admin')).send({ token: BOT_TOKEN }).expect(502);
      expect(offline.body.code).toBe('telegram_unreachable');

      expect((await http().get('/api/telegram').set(as('usr_admin')).expect(200)).body).toEqual({
        bot: null,
        running: false,
        link: null,
        chats: [],
      });
      const noBot = await http().post('/api/telegram/link').set(as('usr_admin')).expect(409);
      expect(noBot.body.code).toBe('telegram_not_connected');
    });

    it('start link bilan ulanadi va savolga AI javob beradi; linksiz — rad', async () => {
      const connected = await http().put('/api/telegram/token').set(as('usr_admin')).send({ token: BOT_TOKEN }).expect(200);
      expect(connected.body).toMatchObject({ bot: { id: 777, username: 'nyff_test_bot', name: 'NYFF' }, running: false });
      expect(connected.body.link).toMatch(/^https:\/\/t\.me\/nyff_test_bot\?start=[\w-]{20,}$/);
      expect(await linkOf('usr_admin')).toBe(connected.body.link);
      expect(await linkOf('usr_admin2')).not.toBe(connected.body.link);
      // token javobda yo'q
      expect(JSON.stringify(connected.body)).not.toContain(BOT_TOKEN.split(':')[1]);

      await send(1001, '/start');
      expect(telegram.last('1001')).toContain('rahbariyati uchun');
      await send(1001, 'Tushum qancha?');
      expect(telegram.last('1001')).toContain('rahbariyati uchun');
      await send(1001, '/start notogri-kod');
      expect(telegram.last('1001')).toContain("Link noto'g'ri");
      expect(gemini.requests).toHaveLength(0);

      await send(1001, `/start ${codeOf(connected.body.link)}`);
      expect(telegram.texts('1001').slice(-2)).toEqual([GREETING, expect.stringContaining('Ulandingiz, Admin Adminov!')]);
      const status = await http().get('/api/telegram').set(as('usr_admin')).expect(200);
      expect(status.body.chats).toEqual([
        expect.objectContaining({ chatId: '1001', userId: 'usr_admin', userName: 'Admin Adminov', username: 'boss', name: 'Direktor Aka' }),
      ]);

      gemini.script = [say('**Bugun** 5 ta buyurtma')];
      await send(1001, 'Bugun nechta buyurtma?');
      expect(telegram.last('1001')).toBe('Bugun 5 ta buyurtma');
      expect(telegram.sent).toContainEqual({ method: 'sendChatAction', params: { chat_id: '1001', action: 'typing' } });
      expect(gemini.requests[0].system).toContain('Telegram');
      // salom (ulanishda) + savol + javob
      expect(await db.manager.countBy(AiMessage, { chat: 'tg:1001', userId: 'usr_admin' })).toBe(3);

      // guruhlar e'tiborsiz
      await service().handleUpdate(BOT_TOKEN, message(-5, 'Tushum?', 'group'));
      expect(telegram.texts('-5')).toEqual([]);

      gemini.script = [
        () => {
          throw new Error('quota exceeded');
        },
      ];
      await send(1001, 'Yana?');
      expect(telegram.last('1001')).toContain('javob bera olmadim');

      await send(1001, '/new');
      expect(telegram.last('1001')).toBe(GREETING);
      expect(await db.manager.countBy(AiMessage, { chat: 'tg:1001' })).toBe(1);

      // shu botning tokeni qayta kiritilsa chatlar qoladi
      await http().put('/api/telegram/token').set(as('usr_admin')).send({ token: BOT_TOKEN }).expect(200);
      expect((await http().get('/api/telegram').set(as('usr_admin')).expect(200)).body.chats).toHaveLength(1);
    });

    it('savolga: kunning birinchisida salom → kutish xabari → javob; keyingisida kutish xabari → javob', async () => {
      // 1001 oldingi testda ulangan; bugungi salom kechaga suriladi — keyingi savol kunning birinchisi
      await db.manager.update(AiMessage, { chat: 'tg:1001', text: GREETING }, {
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      });
      telegram.sent = [];
      gemini.script = [say("Bugun 0 so'm."), say('Kimchi kam qoldi.')];
      await send(1001, 'Bugungi tushum qancha?');
      expect(telegram.texts('1001')).toEqual([GREETING, WAITING.money, "Bugun 0 so'm."]);

      telegram.sent = [];
      await send(1001, 'Omborda nima qoldi?');
      expect(telegram.texts('1001')).toEqual([WAITING.stock, 'Kimchi kam qoldi.']);
      // kutish xabari suhbatga (AI xotirasiga) yozilmaydi
      expect(await db.manager.countBy(AiMessage, { chat: 'tg:1001', text: WAITING.stock })).toBe(0);
    });

    it("buyruqlar: token kiritilganda «Menu» ga yuboriladi; /tushum — tayyor savol; noma'lum buyruq — ro'yxat", async () => {
      telegram.sent = [];
      await http().put('/api/telegram/token').set(as('usr_admin')).send({ token: BOT_TOKEN }).expect(200);
      const menu = telegram.sent.find((s) => s.method === 'setMyCommands')?.params.commands as { command: string }[];
      expect(menu.map((c) => c.command)).toEqual(BOT_COMMANDS.map((c) => c.command));

      // 1001 ulangan, bugun salom berilgan (oldingi test) — kutish xabari va javob
      telegram.sent = [];
      gemini.script = [say("Bugun 0 so'm.")];
      await send(1001, '/tushum@nyff_test_bot');
      const question = BOT_COMMANDS.find((c) => c.command === 'tushum')!.question;
      expect(gemini.requests.at(-1)!.contents.at(-1)!.parts![0].text).toBe(question);
      expect(telegram.texts('1001')).toEqual([WAITING.money, "Bugun 0 so'm."]);

      telegram.sent = [];
      await send(1001, '/yordam');
      expect(telegram.texts('1001')).toEqual([COMMANDS_HELP]);
      expect(gemini.requests).toHaveLength(1);
    });

    it("/parol: keyingi matn — admin panelining yangi paroli (AI'ga ketmaydi, xabar o'chiriladi); /bekor — o'zgarmaydi", async () => {
      // 1001 — usr_admin chati (oldingi testlar)
      telegram.sent = [];
      await send(1001, '/parol');
      expect(telegram.last('1001')).toContain('yangi parolni yozing');
      await send(1001, 'qisqa');
      expect(telegram.last('1001')).toContain('8 tadan 64 tagacha');
      await send(1001, 'yangi-parol-2026');
      expect(telegram.last('1001')).toContain("Parol o'zgartirildi");
      expect(telegram.last('1001')).toContain(ADMIN_LOGIN.email);
      expect(telegram.sent).toContainEqual({ method: 'deleteMessage', params: { chat_id: '1001', message_id: 1 } });
      expect(gemini.requests).toHaveLength(0);
      expect(await db.manager.countBy(AiMessage, { text: 'yangi-parol-2026' })).toBe(0);
      await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(401);
      await http().post('/api/auth/admin-login').send({ email: ADMIN_LOGIN.email, password: 'yangi-parol-2026' }).expect(200);

      // keyingi matn — yana oddiy savol
      gemini.script = [say('Javob.')];
      await send(1001, 'Tushum?');
      expect(telegram.last('1001')).toBe('Javob.');

      // /bekor — parol o'zgarmaydi; boshqa buyruq ham kutishni bekor qiladi
      await send(1001, '/parol');
      await send(1001, '/bekor');
      expect(telegram.last('1001')).toBe("Parol o'zgarmadi.");
      await send(1001, '/parol');
      await send(1001, '/yordam');
      expect(telegram.last('1001')).toBe(COMMANDS_HELP);
      await http().post('/api/auth/admin-login').send({ email: ADMIN_LOGIN.email, password: 'yangi-parol-2026' }).expect(200);

      // ulanmagan chat — rad
      await send(4004, '/parol');
      expect(telegram.last('4004')).toContain('rahbariyati uchun');

      await app.get(AuthService).setPassword('usr_admin', ADMIN_LOGIN.password);
    });

    it("ovozli savol: matnga o'giriladi (ko'rsatilmaydi), kutish xabari, javob — matn bilan, shevada", async () => {
      // 1001 ulangan, bugun salom berilgan (oldingi testlar)
      gemini.heard = 'Bugungi tushum qancha?';
      gemini.script = [say("Bugungi tushum 0 so'm bo'ldi.")];
      gemini.dialect = () => "Bugunki tushum 0 so'm adi.";
      await sendVoice(1001, 5);
      expect(gemini.transcripts).toEqual([
        { system: expect.stringContaining('Khorezm dialect'), audio: Buffer.from('OggS:voice-1001'), mimeType: 'audio/ogg' },
      ]);
      // noaniq tovush biznes so'zlariga, filial va taom nomlariga moslanadi ("tushum" — "Lunchum" emas)
      const branch = (await db.manager.findOneByOrFail(Branch, { id: 'br_chilonzor' })).name;
      expect(gemini.transcripts[0].system).toContain('Vocabulary: tushum');
      expect(gemini.transcripts[0].system).toContain(branch);
      expect(gemini.transcripts[0].system).toContain('Klassik burger');
      // AI'ga eshitilgan matn boradi
      expect(gemini.requests[0].contents.at(-1)!.parts![0].text).toBe('Bugungi tushum qancha?');
      // eshitilgan matn direktorga ko'rsatilmaydi — faqat kutish xabari va javob (ovozli javob yo'q, 2026-11-02)
      expect(telegram.texts('1001')).toEqual([WAITING.money, "Bugunki tushum 0 so'm adi."]);
      expect(telegram.sent.some((s) => s.method === 'sendVoice')).toBe(false);
    });

    it('ovozli savol: 20 soniyadan uzun — ibora; tushunarsiz — qayta yuborish', async () => {
      await sendVoice(1001, 21);
      expect(telegram.texts('1001')).toEqual(["Og'aaa, shuncha narsani nedan bilaman man, oddiyroq savol so'rivaring…"]);
      expect(gemini.transcripts).toHaveLength(0);

      telegram.sent = [];
      gemini.heard = '';
      await sendVoice(1001, 3);
      expect(telegram.last('1001')).toContain('Ovozni tushunolmadim');
      expect(gemini.requests).toHaveLength(0);

      // ulanmagan chat — rad (ovoz o'girilmaydi)
      telegram.sent = [];
      await sendVoice(4004, 3);
      expect(telegram.last('4004')).toContain('rahbariyati uchun');
    });

    it("admin bloklansa yoki roli o'zgarsa — rad; yangi link — eskisi ishlamaydi, chat qoladi; uzish", async () => {
      const link = await linkOf('usr_admin2');
      await send(2002, `/start ${codeOf(link)}`);
      expect(telegram.last('2002')).toContain('Ulandingiz, Direktor Karimov!');

      await db.manager.update(User, 'usr_admin2', { active: false });
      await send(2002, 'Tushum?');
      expect(telegram.last('2002')).toContain('rahbariyati uchun');
      await db.manager.update(User, 'usr_admin2', { active: true, role: 'supplier' });
      await send(2002, 'Tushum?');
      expect(telegram.last('2002')).toContain('rahbariyati uchun');
      await db.manager.update(User, 'usr_admin2', { role: 'admin' });
      expect(gemini.requests).toHaveLength(0);

      const renewed = await http().post('/api/telegram/link').set(as('usr_admin2')).expect(200);
      expect(renewed.body.link).not.toBe(link);
      await send(3003, `/start ${codeOf(link)}`);
      expect(telegram.last('3003')).toContain("Link noto'g'ri");
      gemini.script = [say('Javob')];
      await send(2002, 'Tushum?');
      expect(telegram.last('2002')).toBe('Javob');

      await http().delete('/api/telegram/chats/2002').set(as('usr_admin')).expect(204);
      expect(telegram.last('2002')).toContain('uzildi');
      await send(2002, 'Tushum?');
      expect(telegram.last('2002')).toContain('rahbariyati uchun');
      await http().delete('/api/telegram/chats/2002').set(as('usr_admin')).expect(404);
    });

    it('smena yopilganda — hisobot ulangan admin chatlariga (kassir yoki admin yopsa); yopish botni kutmaydi', async () => {
      // hisobot fonda ketadi — yuborilguncha kutiladi
      const until = async (done: () => boolean) => {
        for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
      };
      const branch = (await db.manager.findOneByOrFail(Branch, { id: 'br_chilonzor' })).name;
      const cashier = fullName(await db.manager.findOneByOrFail(User, { id: 'usr_cashier_c1' }));

      // 1001 — usr_admin chati (oldingi testlar), 2002 — uzilgan; demo smenasida bugungi buyurtmalar bor
      telegram.sent = [];
      const closed = await http().post('/api/shifts/current/close').set(as('usr_cashier_c1')).expect(200);
      await until(() => telegram.texts('1001').length > 0);
      const { summary } = closed.body;
      expect(summary.orderCount).toBeGreaterThan(0);
      const text = telegram.last('1001');
      expect(text.split('\n').slice(0, 2)).toEqual([`Smena yopildi — ${branch}`, `Kassir: ${cashier}`]);
      expect(text).toContain(`Buyurtmalar: ${summary.orderCount} ta`);
      expect(text).toContain(`Tushum: ${som(summary.total)}`);
      expect(text).toContain("Turi bo'yicha:");
      expect(text).toContain("Eng ko'p sotilgan:");
      expect(text).not.toContain('admin yopdi');
      expect(telegram.sent.filter((s) => s.method === 'sendMessage').map((s) => s.params.chat_id)).toEqual(['1001']);
      expect(gemini.requests).toHaveLength(0);

      // kassir yopmay ketgan smenani admin yopadi
      telegram.sent = [];
      const reopened = await http().post('/api/shifts/current').set(as('usr_cashier_c1')).expect(200);
      await http().post(`/api/shifts/${reopened.body.id}/close`).set(as('usr_admin')).expect(200);
      await until(() => telegram.texts('1001').length > 0);
      expect(telegram.last('1001')).toContain('Smenani admin yopdi: Admin Adminov');
      expect(telegram.last('1001')).toContain('Buyurtmalar: 0 ta');
      await http().post('/api/shifts/current').set(as('usr_cashier_c1')).expect(200);
    });

    it("oylik zaxira nusxa: oy tugagach pg_dump → admin chatlariga, fayl o'chadi; katta — bo'laklar; xato — bir marta ogohlantirish", async () => {
      const backup = app.get(BackupService);
      const KEY = 'backup_sent_month';
      const setSent = (value: string | null) =>
        value === null ? db.manager.delete(Setting, { key: KEY }) : db.manager.upsert(Setting, { key: KEY, value }, ['key']);
      const sentMonth = async () => (await db.manager.findOneBy(Setting, { key: KEY }))?.value ?? null;
      const documents = () => telegram.sent.filter((s) => s.method === 'sendDocument');
      const fileOf = (s: { params: Record<string, unknown> }) => s.params.file as TgUpload;
      const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith('nyff-2026-10-'));
      // 10-noyabr: oktyabr tugagan, noyabr hali yo'q
      const now = new Date(2026, 10, 10, 12, 0);
      const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

      // birinchi ishga tushish — o'tgan oylar yuborilmaydi, birinchi nusxa joriy oy oxirida
      await setSent(null);
      telegram.sent = [];
      expect(await backup.tick(now)).toBeNull();
      expect(await sentMonth()).toBe('2026-10');
      expect(documents()).toEqual([]);

      // oktyabr hali yuborilmagan — bitta fayl, 1001 ga (2002 — uzilgan)
      await setSent('2026-09');
      expect(await backup.tick(now)).toBe('2026-10');
      expect(documents()).toHaveLength(1);
      const [single] = documents();
      expect(single.params).toMatchObject({
        chat_id: '1001',
        caption: expect.stringMatching(/^Zaxira nusxa — Oktyabr 2026\nOlingan: 10\.11\.2026 12:00 · \d+,\d MB$/),
        file: { field: 'document', filename: 'nyff-2026-10.dump' },
      });
      expect(fileOf(single).data.subarray(0, 5).toString()).toBe('PGDMP');
      expect(await sentMonth()).toBe('2026-10');
      expect(leftovers()).toEqual([]);
      // yuborilgan — qayta yuborilmaydi
      telegram.sent = [];
      expect(await backup.tick(later(20))).toBeNull();
      expect(documents()).toEqual([]);

      // katta nusxa — bo'laklar: tartib bilan, birlashtirilsa pg_restore o'qiydi
      await setSent('2026-09');
      backup.partBytes = Math.ceil(fileOf(single).data.length / 3);
      try {
        expect(await backup.tick(now)).toBe('2026-10');
      } finally {
        backup.partBytes = PART_BYTES;
      }
      const parts = documents();
      expect(parts.length).toBeGreaterThanOrEqual(3);
      parts.forEach((part, index) => {
        const number = String(index + 1).padStart(3, '0');
        expect(fileOf(part).filename).toBe(`nyff-2026-10.dump.${number}`);
        expect(part.params.caption).toContain(`Oktyabr 2026, ${index + 1}/${parts.length}-qism`);
      });
      const joined = join(tmpdir(), `nyff-test-${process.pid}.dump`);
      writeFileSync(joined, Buffer.concat(parts.map((part) => fileOf(part).data)));
      try {
        const list = await promisify(execFile)(pgDumpPath().replace(/pg_dump(\.exe)?$/, 'pg_restore$1'), ['-l', joined]);
        expect(list.stdout).toContain('TABLE public orders');
      } finally {
        rmSync(joined, { force: true });
      }
      expect(leftovers()).toEqual([]);

      // pg_dump ishlamasa — bir marta ogohlantirish, soat o'tmaguncha qayta urinmaydi, keyin yuboriladi
      await setSent('2026-09');
      telegram.sent = [];
      const previous = process.env.PG_DUMP;
      process.env.PG_DUMP = join(tmpdir(), 'nyff-yoq', 'pg_dump.exe');
      try {
        expect(await backup.tick(now)).toBeNull();
        expect(await backup.tick(later(30))).toBeNull();
      } finally {
        if (previous === undefined) delete process.env.PG_DUMP;
        else process.env.PG_DUMP = previous;
      }
      expect(telegram.texts('1001')).toEqual([expect.stringContaining('Oktyabr 2026 zaxira nusxasi yuborilmadi: pg_dump')]);
      expect(documents()).toEqual([]);
      expect(await sentMonth()).toBe('2026-09');
      expect(await backup.tick(later(61))).toBe('2026-10');
      expect(documents()).toHaveLength(1);
    });

    it("boshqa bot tokeni — chatlar va linklar o'chadi; botni o'chirish", async () => {
      const oldLink = await linkOf('usr_admin');
      telegram.getMe = () => ({ id: 888, is_bot: true, first_name: 'Boshqa', username: 'other_bot' });
      const other = await http().put('/api/telegram/token').set(as('usr_admin')).send({ token: OTHER_BOT_TOKEN }).expect(200);
      expect(other.body).toMatchObject({ bot: { username: 'other_bot' }, chats: [] });
      expect(codeOf(other.body.link)).not.toBe(codeOf(oldLink));
      await send(1001, 'Tushum?');
      expect(telegram.last('1001')).toContain('rahbariyati uchun');

      await http().delete('/api/telegram/token').set(as('usr_admin')).expect(204);
      expect((await http().get('/api/telegram').set(as('usr_admin')).expect(200)).body).toEqual({
        bot: null,
        running: false,
        link: null,
        chats: [],
      });
    });
  });
});
