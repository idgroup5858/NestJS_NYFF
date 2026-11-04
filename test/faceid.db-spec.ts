import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, Like } from 'typeorm';
import { Branch } from '../src/branches/branch.entity';
import { Setting } from '../src/database/setting.entity';
import { FaceIdEvent } from '../src/faceid/faceid-event.entity';
import { FaceIdRequest } from '../src/faceid/faceid-request.entity';
import { Shift } from '../src/shifts/shift.entity';
import { OfflineKeysService } from '../src/sync/offline-keys.service';
import { TelegramChat } from '../src/telegram/telegram-chat.entity';
import { TelegramApi, type TgUpdate } from '../src/telegram/telegram.api';
import { TelegramService } from '../src/telegram/telegram.service';
import { User } from '../src/users/user.entity';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C, BRANCH_YUNUSOBOD as Y } from './fixtures/demo-data';
import { createTestApp } from './test-app';

const DILNOZA = 'usr_cashier_c1'; // PIN 1234, Chilonzor (testda — Yunusobod ham)
const SARDOR = 'usr_cashier_c2'; // PIN 4321, Chilonzor
const MALIKA = 'usr_cashier_y1'; // PIN 1234, Yunusobod
const AZIZ = 'usr_kitchen_c1'; // PIN 1111, Chilonzor
const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const ADMIN_CHAT = '1001';
const STRANGER_CHAT = '2002';

/** Telegram soxtasi: `sendMessage` — xabar id'si bilan (FaceID so'rovi tahrirlanadi). */
class FakeTelegram {
  sent: { method: string; params: Record<string, unknown> }[] = [];
  private nextId = 500;

  async call<T>(_token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.sent.push({ method, params });
    if (method === 'sendMessage') return { message_id: this.nextId++, date: 0, chat: { id: Number(params.chat_id), type: 'private' } } as T;
    return true as T;
  }

  of(method: string) {
    return this.sent.filter((s) => s.method === method).map((s) => s.params);
  }
}

/**
 * FaceID (2026-11-04): filial HR tizimi terminaldagi «Kirish» / «Chiqish» larni yuboradi (`X-Hr-Key`); filialda
 * tekshiruv yoqilgan bo'lsa kassir smenani terminaldan o'tib ochadi / topshiradi, kassaga kirish va blokdan chiqish —
 * oxirgi o'tishi shu filialda «Kirish» bo'lsa; terminal ishlamasa — admin Telegram orqali ruxsat beradi yoki
 * kartochkada o'chiradi.
 */
describe('FaceID', () => {
  let app: INestApplication;
  let db: DataSource;
  let admin: string;
  const telegram = new FakeTelegram();
  const hrKey: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (userId: string, pin: string, branchId: string) =>
    http().post('/api/auth/login').send({ userId, pin, branchId });
  const ev = (employeeNo: string | number, status: string, minutesAgo: number, device = 'Kirish eshigi') => ({
    employeeNo: String(employeeNo),
    status,
    occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    device,
  });
  const push = (branchId: string, events: ReturnType<typeof ev>[]) =>
    http().post('/api/hr/events').set('X-Hr-Key', hrKey[branchId]).send({ events });
  const setFaceId = (branchId: string, enabled: boolean) =>
    http().put(`/api/branches/${branchId}/faceid`).set(bearer(admin)).send({ enabled }).expect(200);
  const saveUser = async (id: string, patch: Record<string, unknown>, status = 200) => {
    const user = await db.manager.findOneByOrFail(User, { id });
    const body = { name: user.name, surname: user.surname, role: user.role, branchIds: user.branchIds, pin: '', active: true };
    return http().patch(`/api/users/${id}`).set(bearer(admin)).send({ ...body, ...patch }).expect(status);
  };
  const errorCode = (res: request.Response) => (res.body as { code?: string }).code;

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(TelegramApi).useValue(telegram));
    db = app.get(DataSource);
    await seedDemo(app, { activity: false });
    // sinov to'plami `settings` ga tegmaydi — oldingi test fayllari yaratgan kalitlar / bot qolgan bo'lishi mumkin
    await db.manager.delete(Setting, { key: Like('hr_key:%') });
    await db.manager.delete(Setting, { key: Like('telegram_%') });
    admin = (await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('HR kaliti va ulanish', () => {
    it("admin: ko'rish (yo'q bo'lsa yaratiladi), yangilash — eskisi ishlamaydi; boshqa rollar — yo'q", async () => {
      const shown = (await http().get(`/api/branches/${C}/hr-key`).set(bearer(admin)).expect(200)).body.key as string;
      expect(shown).toMatch(/^br_chilonzor\.[A-Za-z0-9_-]{32}$/);
      expect((await http().get(`/api/branches/${C}/hr-key`).set(bearer(admin)).expect(200)).body).toEqual({ key: shown });

      const renewed = (await http().post(`/api/branches/${C}/hr-key`).set(bearer(admin)).expect(200)).body.key as string;
      expect(renewed).not.toBe(shown);
      expect(errorCode(await http().get('/api/hr/ping').set('X-Hr-Key', shown).expect(401))).toBe('unauthorized');
      expect((await http().get('/api/hr/ping').set('X-Hr-Key', renewed).expect(200)).body).toEqual({
        branch: { id: C, name: 'Chilonzor' },
      });
      hrKey[C] = renewed;
      hrKey[Y] = (await http().get(`/api/branches/${Y}/hr-key`).set(bearer(admin)).expect(200)).body.key;

      await http().get('/api/branches/br_yoq/hr-key').set(bearer(admin)).expect(404);
      const cashier = (await login(SARDOR, '4321', C).expect(200)).body.token;
      await http().get(`/api/branches/${C}/hr-key`).set(bearer(cashier)).expect(403);
      await http().post(`/api/branches/${C}/hr-key`).set(bearer(cashier)).expect(403);
      await http().get(`/api/branches/${C}/hr-key`).expect(401);
      await http().get('/api/hr/ping').expect(401);
      // xodim tokeni HR kaliti emas
      await http().get('/api/hr/ping').set(bearer(admin)).expect(401);
    });

    it("offline kalit va HR kaliti — alohida: biri ikkinchisining o'rniga ishlamaydi", async () => {
      const offlineKey = await app.get(OfflineKeysService).get(C);
      await http().get('/api/hr/ping').set('X-Hr-Key', offlineKey).expect(401);
      await http().get('/api/sync/snapshot').set('x-offline-key', hrKey[C]).expect(401);
      await http().get('/api/sync/snapshot').set('x-offline-key', offlineKey).expect(200);
    });

    it("HR murojaati — kartochkada (`hrSeenAt`); FaceID tugmasi — faqat admin", async () => {
      await db.query(`UPDATE branches SET "hrSeenAt" = NULL`);
      await http().get('/api/hr/ping').set('X-Hr-Key', hrKey[C]).expect(200);
      const branches = (await http().get('/api/branches').expect(200)).body as Branch[];
      expect(branches.find((b) => b.id === C)?.hrSeenAt).toEqual(expect.any(String));
      expect(branches.find((b) => b.id === Y)?.hrSeenAt).toBeNull();
      expect(branches.every((b) => b.faceIdRequired === false)).toBe(true);

      expect((await setFaceId(C, true)).body).toMatchObject({ id: C, faceIdRequired: true });
      expect((await db.manager.findOneByOrFail(Branch, { id: C })).faceIdRequired).toBe(true);
      await setFaceId(C, false);
      const cashier = (await login(SARDOR, '4321', C).expect(200)).body.token;
      await http().put(`/api/branches/${C}/faceid`).set(bearer(cashier)).send({ enabled: true }).expect(403);
      await http().put('/api/branches/br_yoq/faceid').set(bearer(admin)).send({ enabled: true }).expect(404);
      await http().put(`/api/branches/${C}/faceid`).set(bearer(admin)).send({ enabled: 'ha' }).expect(400);
      await db.query(`UPDATE shifts SET "closedAt" = now() WHERE "closedAt" IS NULL`);
    });
  });

  describe('tabel raqami (Xodimlar)', () => {
    it("kassirga har filial uchun; ro'yxatda yo'q filial — tashlanadi; noto'g'ri — invalid_employee_no", async () => {
      const saved = await saveUser(DILNOZA, { branchIds: [C, Y], employeeNos: { [C]: 17, [Y]: 5, br_boshqa: 9 } });
      expect(saved.body.employeeNos).toEqual({ [C]: 17, [Y]: 5 });
      for (const bad of [0, -3, 1.5, '18', 1_000_000_000]) {
        expect(errorCode(await saveUser(SARDOR, { employeeNos: { [C]: bad } }, 400))).toBe('invalid_employee_no');
      }
      // bo'sh qiymat — raqamsiz
      expect((await saveUser(SARDOR, { employeeNos: { [C]: null } })).body.employeeNos).toEqual({});
    });

    it("bir filialda bitta raqam — bitta kassirda (kimdaligi bilan); boshqa filialda bir xil raqam — mumkin", async () => {
      const taken = await saveUser(SARDOR, { employeeNos: { [C]: 17 } }, 409);
      expect(taken.body).toMatchObject({ code: 'employee_no_taken', detail: 'Dilnoza Karimova' });
      expect((await saveUser(MALIKA, { employeeNos: { [Y]: 17 } })).body.employeeNos).toEqual({ [Y]: 17 });
      expect((await saveUser(SARDOR, { employeeNos: { [C]: 18 } })).body.employeeNos).toEqual({ [C]: 18 });
      // o'zining raqamini qayta saqlash — band emas
      await saveUser(DILNOZA, { employeeNos: { [C]: 17, [Y]: 5 } });
    });

    it("berilmasa — o'zgarmaydi; filialdan olib tashlansa — raqami ham; kassir bo'lmagan rol — yo'q", async () => {
      expect((await saveUser(DILNOZA, {})).body.employeeNos).toEqual({ [C]: 17, [Y]: 5 });
      expect((await saveUser(DILNOZA, { branchIds: [C] })).body.employeeNos).toEqual({ [C]: 17 });
      expect((await saveUser(AZIZ, { employeeNos: { [C]: 40 } })).body.employeeNos).toEqual({});
      await saveUser(DILNOZA, { branchIds: [C, Y], employeeNos: { [C]: 17, [Y]: 5 } });
      // yangi kassir
      const created = await http()
        .post('/api/users')
        .set(bearer(admin))
        .send({ name: 'Yangi', surname: 'Kassir', role: 'cashier', branchIds: [C], employeeNos: { [C]: 77 }, pin: '7777', active: true })
        .expect(201);
      expect(created.body.employeeNos).toEqual({ [C]: 77 });
      await http().delete(`/api/users/${created.body.id}`).set(bearer(admin)).expect(204);
    });
  });

  describe('HR hodisalari', () => {
    beforeEach(async () => {
      await db.manager.clear(FaceIdEvent);
    });

    it("faqat kassir (shu filialdagi tabel raqami) va «Kirish» / «Chiqish» saqlanadi; takrori tashlanadi", async () => {
      const same = ev(17, 'checkIn', 1);
      const future = ev(18, 'checkOut', -60);
      const res = await push(C, [
        same,
        same,
        ev(99, 'checkIn', 1), // hech kimniki emas
        ev(18, 'breakOut', 1), // tushlik — hisobga olinmaydi
        ev('A17', 'checkIn', 1),
        ev(5, 'checkIn', 1), // Dilnozaning Yunusoboddagi raqami — Chilonzorda emas
        future, // terminal soati oldinda
      ]).expect(200);
      expect(res.body).toEqual({ saved: 2, ignored: 5 });

      const saved = await db.manager.find(FaceIdEvent, { order: { userId: 'ASC' } });
      expect(saved.map((e) => [e.userId, e.branchId, e.employeeNo, e.status, e.device])).toEqual([
        [DILNOZA, C, 17, 'checkIn', 'Kirish eshigi'],
        [SARDOR, C, 18, 'checkOut', 'Kirish eshigi'],
      ]);
      // kelajakdagi vaqt — qabul qilingan vaqt bilan
      expect(saved[1].occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(saved[1].occurredAt.getTime()).toBe(saved[1].receivedAt.getTime());

      // qayta yuborish (HR javobni olmagan) — takrorlanmaydi
      expect((await push(C, [same]).expect(200)).body).toEqual({ saved: 0, ignored: 1 });
      // boshqa filialning kaliti — o'sha filialdagi raqamlar
      expect((await push(Y, [ev(5, 'checkIn', 1)]).expect(200)).body).toEqual({ saved: 1, ignored: 0 });
      expect(await db.manager.countBy(FaceIdEvent, { userId: DILNOZA, branchId: Y })).toBe(1);
    });

    it("bloklangan kassir — saqlanmaydi; shakl xato — invalid_input; 200 tadan ko'p — invalid_input", async () => {
      await db.manager.update(User, { id: SARDOR }, { active: false });
      expect((await push(C, [ev(18, 'checkIn', 1)]).expect(200)).body).toEqual({ saved: 0, ignored: 1 });
      await db.manager.update(User, { id: SARDOR }, { active: true });

      const noTime = await http()
        .post('/api/hr/events')
        .set('X-Hr-Key', hrKey[C])
        .send({ events: [{ employeeNo: '17', status: 'checkIn' }] })
        .expect(400);
      expect(errorCode(noTime)).toBe('invalid_input');
      const many = Array.from({ length: 201 }, (_, i) => ev(17, 'checkIn', i));
      expect(errorCode(await push(C, many).expect(400))).toBe('invalid_input');
      await http().post('/api/hr/events').send({ events: [] }).expect(401);
    });
  });

  describe("kassa qoidalari (Chilonzor'da FaceID yoqilgan)", () => {
    beforeAll(async () => {
      await setFaceId(C, true);
    });

    beforeEach(async () => {
      await db.manager.clear(FaceIdEvent);
      await db.query(`DELETE FROM faceid_requests`);
      await db.query(`UPDATE shifts SET "closedAt" = now() WHERE "closedAt" IS NULL`);
    });

    afterAll(async () => {
      await setFaceId(C, false);
    });

    const openShiftsOf = async (cashierId: string) =>
      (await db.manager.findBy(Shift, { cashierId })).filter((s) => s.closedAt === null);

    it("terminaldan o'tmagan — PIN to'g'ri bo'lsa ham smena ochilmaydi; PIN noto'g'ri — avval wrong_pin", async () => {
      expect(errorCode(await login(DILNOZA, '0000', C).expect(401))).toBe('wrong_pin');
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');
      expect(await openShiftsOf(DILNOZA)).toHaveLength(0);
      // FaceID o'chiq filial (Yunusobod) — avvalgidek
      await login(DILNOZA, '1234', Y).expect(200);
      expect((await openShiftsOf(DILNOZA))[0].branchId).toBe(Y);
    });

    it("smena ochish — shu filialda «Kirish», 10 daqiqa ichida; eski «Kirish» yoki «Chiqish» — yo'q", async () => {
      await push(C, [ev(17, 'checkIn', 11)]).expect(200);
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');
      await push(C, [ev(17, 'checkOut', 2)]).expect(200);
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');
      await push(C, [ev(17, 'checkIn', 1)]).expect(200);
      const ok = await login(DILNOZA, '1234', C).expect(200);
      expect(ok.body.shift).toMatchObject({ branchId: C, cashierId: DILNOZA, closedAt: null });
    });

    it("davom ettirish va blokdan chiqish — «Kirish» dan keyin 16 soatgacha; boshqa filialda «Kirish» — yopiladi", async () => {
      await push(C, [ev(17, 'checkIn', 1)]).expect(200);
      const token = (await login(DILNOZA, '1234', C).expect(200)).body.token as string;
      // ertalab kelgan — kunduzi kassa bloklanadi, PIN bilan ochiladi (terminalga borish shart emas)
      await db.query(`UPDATE faceid_events SET "occurredAt" = now() - interval '5 hours'`);
      await http().post('/api/auth/unlock').set(bearer(token)).send({ pin: '1234' }).expect(200);
      await login(DILNOZA, '1234', C).expect(200);
      // tushlikka «Chiqish» bosib ketdi — ochiq kassada sotuv to'xtamaydi (`POST /shifts/current` har sotuvdan oldin),
      // kassani PIN bilan ochish — 10 daqiqadan keyin yo'q
      await push(C, [ev(17, 'checkOut', 30)]).expect(200);
      await db.query(`UPDATE faceid_events SET "occurredAt" = now() - interval '30 minutes' WHERE status = 'checkOut'`);
      await http().post('/api/shifts/current').set(bearer(token)).expect(200);
      await http()
        .post('/api/orders')
        .set(bearer(token))
        .send({ type: 'takeaway', items: [{ productId: 'burger-classic', qty: 1 }], payment: 'cash' })
        .expect(201);
      expect(errorCode(await http().post('/api/auth/unlock').set(bearer(token)).send({ pin: '1234' }).expect(409))).toBe(
        'faceid_checkin_required',
      );
      await push(C, [ev(17, 'checkIn', 0.5)]).expect(200);
      await http().post('/api/auth/unlock').set(bearer(token)).send({ pin: '1234' }).expect(200);
      // smena 1-filialda ochiq qoldi, 2-filialda «Kirish» bosdi — 1-filial kassasiga kira olmaydi
      await push(Y, [ev(5, 'checkIn', 0)]).expect(200);
      expect(errorCode(await http().post('/api/auth/unlock').set(bearer(token)).send({ pin: '1234' }).expect(409))).toBe(
        'faceid_checkin_required',
      );
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');
      // 2-filialda ham smena ochilmaydi — 1-filialdagisi ochiq (avvalgi qoida)
      expect(errorCode(await login(DILNOZA, '1234', Y).expect(409))).toBe('shift_open_elsewhere');
    });

    it("16 soatdan eski «Kirish» — kirib bo'lmaydi (kecha yopilmay qolgan smenaga ertasi kuni uydan)", async () => {
      await push(C, [ev(17, 'checkIn', 1)]).expect(200);
      await login(DILNOZA, '1234', C).expect(200);
      await db.query(`UPDATE faceid_events SET "occurredAt" = now() - interval '17 hours'`);
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');
    });

    it("smenani topshirish — «Chiqish» 10 daqiqa ichida (kassa bloklangan bo'lsa ham ochiladi); admin — tekshiruvsiz", async () => {
      await push(C, [ev(17, 'checkIn', 5)]).expect(200);
      const token = (await login(DILNOZA, '1234', C).expect(200)).body.token as string;
      expect(errorCode(await http().post('/api/shifts/current/close').set(bearer(token)).expect(409))).toBe(
        'faceid_checkout_required',
      );
      await push(C, [ev(17, 'checkOut', 2)]).expect(200);
      const unlocked = (await http().post('/api/auth/unlock').set(bearer(token)).send({ pin: '1234' }).expect(200)).body.token;
      const closed = await http().post('/api/shifts/current/close').set(bearer(unlocked)).expect(200);
      expect(closed.body.closedAt).not.toBeNull();

      // «Chiqish» eskirgan (11 daqiqa) — kassir topshira ham, kassani ocha ham olmaydi, admin yopadi
      await push(C, [ev(17, 'checkIn', 1)]).expect(200);
      const again = (await login(DILNOZA, '1234', C).expect(200)).body as { token: string; shift: Shift };
      await db.query(`UPDATE faceid_events SET "occurredAt" = "occurredAt" - interval '30 minutes'`);
      await push(C, [ev(17, 'checkOut', 11)]).expect(200);
      expect(errorCode(await http().post('/api/shifts/current/close').set(bearer(again.token)).expect(409))).toBe(
        'faceid_checkout_required',
      );
      expect(errorCode(await http().post('/api/auth/unlock').set(bearer(again.token)).send({ pin: '1234' }).expect(409))).toBe(
        'faceid_checkin_required',
      );
      await http().post(`/api/shifts/${again.shift.id}/close`).set(bearer(admin)).expect(200);
    });

    it("tekshiruv o'chirilsa — avvalgidek; oshpaz yordamchisiga ta'siri yo'q", async () => {
      await login(AZIZ, '1111', C).expect(200);
      await setFaceId(C, false);
      const token = (await login(DILNOZA, '1234', C).expect(200)).body.token;
      await http().post('/api/shifts/current/close').set(bearer(token)).expect(200);
      await setFaceId(C, true);
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');
    });
  });

  describe('Telegram orqali ruxsat', () => {
    const callback = (chatId: string, data: string, id = 'cb1'): TgUpdate => ({
      update_id: 1,
      callback_query: {
        id,
        from: { id: Number(chatId), is_bot: false, first_name: 'Admin' },
        message: { message_id: 1, date: 0, chat: { id: Number(chatId), type: 'private' } },
        data,
      },
    });
    const press = (chatId: string, data: string) => app.get(TelegramService).handleUpdate(BOT_TOKEN, callback(chatId, data));
    const ask = (userId = DILNOZA, pin = '1234', branchId = C) =>
      http().post('/api/auth/faceid-request').send({ userId, pin, branchId });
    const view = (id: string) => http().get(`/api/auth/faceid-request/${id}`).expect(200);
    const lastAnswer = () => telegram.of('answerCallbackQuery').at(-1)?.text;
    // tugmali xabarlar (smena hisoboti kechikib kelishi mumkin — u sanalmaydi)
    const requestsSent = () => telegram.of('sendMessage').filter((m) => m.reply_markup);

    beforeAll(async () => {
      await setFaceId(C, true);
    });

    beforeEach(async () => {
      await db.manager.clear(FaceIdEvent);
      await db.query(`DELETE FROM faceid_requests`);
      await db.query(`UPDATE shifts SET "closedAt" = now() WHERE "closedAt" IS NULL`);
      telegram.sent = [];
    });

    afterAll(async () => {
      await setFaceId(C, false);
    });

    it("bot ulanmagan — faceid_request_unavailable (adminga qo'ng'iroq)", async () => {
      expect(errorCode(await ask().expect(503))).toBe('faceid_request_unavailable');
      // bot bor, lekin admin chati yo'q
      await db.manager.upsert(
        Setting,
        [
          { key: 'telegram_bot_token', value: BOT_TOKEN },
          { key: 'telegram_bot', value: JSON.stringify({ id: 777, username: 'nyff_test_bot', name: 'NYFF' }) },
        ],
        ['key'],
      );
      expect(errorCode(await ask().expect(503))).toBe('faceid_request_unavailable');
      await db.manager.insert(TelegramChat, { chatId: ADMIN_CHAT, userId: 'usr_admin', username: 'admin', name: 'Admin', linkedAt: new Date() });
    });

    it("PIN bilan so'rov — admin chatiga tugmali xabar; javob kutilayotganda qayta so'rov — o'sha", async () => {
      expect(errorCode(await ask(DILNOZA, '0000').expect(401))).toBe('wrong_pin');
      // rol PIN'dan oldin — admin paroli bu yerda sinab ko'rilmaydi (urinish sanalmaydi)
      expect(errorCode(await ask('usr_admin', '1234').expect(403))).toBe('forbidden');
      expect(errorCode(await ask(AZIZ, '1111').expect(403))).toBe('forbidden');
      expect(errorCode(await ask(MALIKA, '1234', C).expect(403))).toBe('forbidden');
      expect(requestsSent()).toHaveLength(0);

      const first = (await ask().expect(200)).body;
      expect(first).toMatchObject({ id: expect.stringMatching(/^fid_[0-9a-f]{16}$/), action: 'open', status: 'pending' });
      const [message] = requestsSent();
      expect(message.chat_id).toBe(ADMIN_CHAT);
      expect(message.text).toContain('Filial: Chilonzor');
      expect(message.text).toContain('Kassir: Dilnoza Karimova');
      expect(message.text).toContain('Amal: smena ochish');
      expect(message.reply_markup).toEqual({
        inline_keyboard: [
          [
            { text: '✅ Ruxsat berish', callback_data: `fid:${first.id}:1` },
            { text: '❌ Rad etish', callback_data: `fid:${first.id}:0` },
          ],
        ],
      });

      expect((await ask().expect(200)).body.id).toBe(first.id);
      expect(requestsSent()).toHaveLength(1);
      expect((await view(first.id)).body).toMatchObject({ status: 'pending' });
      await http().get('/api/auth/faceid-request/fid_0000000000000000').expect(404);
    });

    it("begona chat — rad; admin «Ruxsat berish» — kassir 10 daqiqa FaceID'siz; ikkinchi bosish — o'zgarmaydi", async () => {
      const { id } = (await ask().expect(200)).body;
      await press(STRANGER_CHAT, `fid:${id}:1`);
      expect(lastAnswer()).toContain('rahbariyati uchun');
      expect((await view(id)).body.status).toBe('pending');

      await press(ADMIN_CHAT, `fid:${id}:1`);
      expect(lastAnswer()).toBe('Ruxsat berildi');
      expect((await view(id)).body).toMatchObject({ status: 'approved', until: expect.any(String) });
      const [edited] = telegram.of('editMessageText');
      expect(edited).toMatchObject({ chat_id: ADMIN_CHAT, message_id: expect.any(Number) });
      expect(edited.text).toContain('✅ Ruxsat berildi — Admin Adminov');
      expect(edited.reply_markup).toBeUndefined();

      // terminalsiz kiradi va (ruxsat amal qilguncha) topshiradi
      const token = (await login(DILNOZA, '1234', C).expect(200)).body.token;
      await http().post('/api/shifts/current/close').set(bearer(token)).expect(200);

      await press(ADMIN_CHAT, `fid:${id}:0`);
      expect(lastAnswer()).toBe('Allaqachon hal qilingan');
      expect((await view(id)).body.status).toBe('approved');

      // ruxsat 10 daqiqa — keyin yana terminal
      await db.query(`UPDATE faceid_requests SET "decidedAt" = now() - interval '11 minutes'`);
      expect((await view(id)).body.status).toBe('expired');
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');
    });

    it("ochiq kassadan (topshirish) — token bilan; «Rad etish» — ruxsat yo'q; boshqa kassirga ta'siri yo'q", async () => {
      await push(C, [ev(17, 'checkIn', 1)]).expect(200);
      const token = (await login(DILNOZA, '1234', C).expect(200)).body.token;
      const asked = (await http().post('/api/shifts/current/faceid-request').set(bearer(token)).expect(200)).body;
      expect(asked).toMatchObject({ action: 'close', status: 'pending' });
      expect(requestsSent()[0].text).toContain('Amal: smenani topshirish');

      await press(ADMIN_CHAT, `fid:${asked.id}:0`);
      expect(lastAnswer()).toBe('Rad etildi');
      expect((await view(asked.id)).body.status).toBe('rejected');
      expect(telegram.of('editMessageText')[0].text).toContain('❌ Rad etildi — Admin Adminov');
      expect(errorCode(await http().post('/api/shifts/current/close').set(bearer(token)).expect(409))).toBe(
        'faceid_checkout_required',
      );

      // ruxsat Dilnozaga berilsa — Sardorga emas
      const other = (await ask().expect(200)).body;
      await press(ADMIN_CHAT, `fid:${other.id}:1`);
      expect(errorCode(await login(SARDOR, '4321', C).expect(409))).toBe('faceid_checkin_required');
      // ochiq kassadan so'rash — faqat kassir
      await http().post('/api/shifts/current/faceid-request').set(bearer(admin)).expect(403);
    });

    it("javob berilmagan so'rov 10 daqiqada eskiradi — bosilsa «muddati o'tgan», keyingi so'rov — yangi xabar", async () => {
      const { id } = (await ask().expect(200)).body;
      await db.query(`UPDATE faceid_requests SET "createdAt" = now() - interval '11 minutes'`);
      expect((await view(id)).body.status).toBe('expired');
      await press(ADMIN_CHAT, `fid:${id}:1`);
      expect(lastAnswer()).toBe("So'rov muddati o'tgan");
      expect(telegram.of('editMessageText')[0].text).toContain("Muddati o'tdi");
      expect(errorCode(await login(DILNOZA, '1234', C).expect(409))).toBe('faceid_checkin_required');

      const next = (await ask().expect(200)).body;
      expect(next.id).not.toBe(id);
      expect(requestsSent()).toHaveLength(2);
      // noma'lum so'rov / buzilgan tugma — faqat javob
      await press(ADMIN_CHAT, 'fid:fid_0000000000000000:1');
      expect(lastAnswer()).toBe("So'rov topilmadi");
      await press(ADMIN_CHAT, 'boshqa');
      expect((await view(next.id)).body.status).toBe('pending');
      expect(await db.manager.countBy(FaceIdRequest, { status: 'approved' })).toBe(0);
    });
  });

  describe("o'chirish", () => {
    it("filial / xodim o'chirilsa — FaceID yozuvlari va HR kaliti ham", async () => {
      await setFaceId(C, false);
      const created = await http()
        .post('/api/branches')
        .set(bearer(admin))
        .send({ name: "O'chiriladigan", address: '', phone: '', active: true })
        .expect(201);
      const branchId = created.body.id as string;
      const key = (await http().get(`/api/branches/${branchId}/hr-key`).set(bearer(admin)).expect(200)).body.key;
      const user = (
        await http()
          .post('/api/users')
          .set(bearer(admin))
          .send({ name: 'Vaqtincha', surname: 'Kassir', role: 'cashier', branchIds: [branchId], employeeNos: { [branchId]: 3 }, pin: '3333', active: true })
          .expect(201)
      ).body as { id: string };
      await http().post('/api/hr/events').set('X-Hr-Key', key).send({ events: [ev(3, 'checkIn', 1)] }).expect(200);
      expect(await db.manager.countBy(FaceIdEvent, { branchId })).toBe(1);

      await http().delete(`/api/users/${user.id}`).set(bearer(admin)).expect(204);
      expect(await db.manager.countBy(FaceIdEvent, { branchId })).toBe(0);
      await http().delete(`/api/branches/${branchId}`).set(bearer(admin)).expect(204);
      expect(await db.manager.existsBy(Setting, { key: `hr_key:${branchId}` })).toBe(false);
      await http().get('/api/hr/ping').set('X-Hr-Key', key).expect(401);
    });
  });
});
