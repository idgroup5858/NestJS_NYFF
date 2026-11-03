import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource, In, Like } from 'typeorm';
import { Setting } from '../src/database/setting.entity';
import { Order } from '../src/orders/order.entity';
import { ScreenCodesService } from '../src/screens/screen-codes.service';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C, BRANCH_YUNUSOBOD as Y } from './fixtures/demo-data';
import { createTestApp } from './test-app';

type Connected = { socket: Socket; rooms: string[] | null; code: string | null };

/** Ulanadi va `ready` (xonalar) yoki `auth_error` (kodi bilan) ni kutadi. */
function connect(url: string, auth: Record<string, string>): Promise<Connected> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { auth, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error("socket: javob yo'q")), 5000);
    socket.on('ready', (data: { rooms: string[] }) => {
      clearTimeout(timer);
      resolve({ socket, rooms: data.rooms, code: null });
    });
    socket.on('auth_error', (data: { code: string }) => {
      clearTimeout(timer);
      resolve({ socket, rooms: null, code: data.code });
    });
  });
}

/**
 * Filialning zal ekranlari kodlari (admin "Filiallar" → "TV kodi" / "Kiosk kodi"): TV navbati (`X-Tv-Code`) va TV
 * socket'i (`{ tvBranchId, tvCode }`), kiosk buyurtmasi va tekshiruvi (`X-Kiosk-Code`) — faqat shu kod bilan; kodlar
 * bir-biridan alohida; yangilansa — eski kod ishlamaydi, ulangan TV uziladi; noto'g'ri kod uchun blok yo'q.
 */
describe('TV va kiosk kodlari', () => {
  let app: INestApplication;
  let db: DataSource;
  let url: string;
  let admin: string;
  let codes: ScreenCodesService;
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const queue = (branchId: string, code?: string) => {
    const req = http().get(`/api/tv/queue?branchId=${branchId}`);
    return code === undefined ? req : req.set('X-Tv-Code', code);
  };
  const kioskBody = (branchId: string) => ({ branchId, type: 'takeaway', items: [{ productId: 'burger-classic', qty: 1 }], payment: null });
  const kioskOrder = (branchId: string, code?: string) => {
    const req = http().post('/api/kiosk/orders');
    return (code === undefined ? req : req.set('X-Kiosk-Code', code)).send(kioskBody(branchId));
  };
  const kioskCheck = (branchId: string, code?: string) => {
    const req = http().get(`/api/kiosk/check?branchId=${branchId}`);
    return code === undefined ? req : req.set('X-Kiosk-Code', code);
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    db = app.get(DataSource);
    codes = app.get(ScreenCodesService);
    await seedDemo(app, { activity: false });
    // sinov to'plami `settings` ga tegmaydi — oldingi test fayllari yaratgan kodlar qolgan bo'lishi mumkin
    await db.manager.delete(Setting, { key: Like('tv_code:%') });
    await db.manager.delete(Setting, { key: Like('kiosk_code:%') });
    admin = (await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    process.env.THROTTLE = 'off';
    await app.close();
  });

  describe('TV', () => {
    it("admin: ko'rish (yo'q bo'lsa yaratiladi, keyin — o'sha kod), yangilash; boshqa rollar — yo'q", async () => {
      expect(await db.manager.existsBy(Setting, { key: `tv_code:${C}` })).toBe(false);
      const shown = (await http().get(`/api/branches/${C}/tv-code`).set(bearer(admin)).expect(200)).body.code as string;
      expect(shown).toMatch(/^\d{8}$/);
      expect((await http().get(`/api/branches/${C}/tv-code`).set(bearer(admin)).expect(200)).body).toEqual({ code: shown });
      // har filialning o'z kodi
      const other = (await http().get(`/api/branches/${Y}/tv-code`).set(bearer(admin)).expect(200)).body.code;
      expect(other).not.toBe(shown);

      const renewed = (await http().post(`/api/branches/${C}/tv-code`).set(bearer(admin)).expect(200)).body.code;
      expect(renewed).toMatch(/^\d{8}$/);
      expect(renewed).not.toBe(shown);
      expect((await queue(C, shown).expect(401)).body.code).toBe('wrong_tv_code');
      await queue(C, renewed).expect(200);

      await http().get('/api/branches/br_yoq/tv-code').set(bearer(admin)).expect(404);
      await http().post('/api/branches/br_yoq/tv-code').set(bearer(admin)).expect(404);
      const cashier = (await http().post('/api/auth/login').send({ userId: 'usr_cashier_c1', pin: '1234' }).expect(200)).body.token;
      await http().get(`/api/branches/${C}/tv-code`).set(bearer(cashier)).expect(403);
      await http().post(`/api/branches/${C}/tv-code`).set(bearer(cashier)).expect(403);
      await http().get(`/api/branches/${C}/tv-code`).expect(401);
    });

    it("navbat: kodsiz, noto'g'ri va boshqa filial kodi bilan — wrong_tv_code; bo'sh joy / chiziqcha bilan ham bo'ladi", async () => {
      const codeC = await codes.get('tv', C);
      const codeY = await codes.get('tv', Y);
      expect((await queue(C).expect(401)).body.code).toBe('wrong_tv_code');
      expect((await queue(C, '').expect(401)).body.code).toBe('wrong_tv_code');
      expect((await queue(C, '00000000').expect(401)).body.code).toBe('wrong_tv_code');
      expect((await queue(C, codeY).expect(401)).body.code).toBe('wrong_tv_code');
      // kod yaratilmagan / noma'lum filial — ham kod xatosi (qaysi filial borligi bilinmaydi)
      expect((await queue('br_yoq', codeC).expect(401)).body.code).toBe('wrong_tv_code');
      expect((await http().get('/api/tv/queue').set('X-Tv-Code', codeC).expect(400)).body.code).toBe('branch_required');

      const ok = await queue(C, `${codeC.slice(0, 4)} ${codeC.slice(4)}`).expect(200);
      expect(Object.keys(ok.body).sort()).toEqual(['preparing', 'ready']);
      await queue(C, `${codeC.slice(0, 4)}-${codeC.slice(4)}`).expect(200);

      // to'g'ri kod, lekin filial faol emas
      await db.query(`UPDATE branches SET active = false WHERE id = $1`, [Y]);
      expect((await queue(Y, codeY).expect(404)).body.code).toBe('not_found');
      await db.query(`UPDATE branches SET active = true WHERE id = $1`, [Y]);
    });

    it("socket: kodsiz / noto'g'ri — auth_error wrong_tv_code; to'g'ri — tv:<filial>; kod yangilansa — uziladi", async () => {
      const code = await codes.get('tv', C);
      expect(await connect(url, { tvBranchId: C })).toMatchObject({ rooms: null, code: 'wrong_tv_code' });
      expect(await connect(url, { tvBranchId: C, tvCode: '12345678' })).toMatchObject({ rooms: null, code: 'wrong_tv_code' });
      expect(await connect(url, { tvBranchId: Y, tvCode: code })).toMatchObject({ rooms: null, code: 'wrong_tv_code' });

      const tv = await connect(url, { tvBranchId: C, tvCode: code });
      sockets.push(tv.socket);
      expect(tv.rooms).toEqual([`tv:${C}`]);
      const tvY = await connect(url, { tvBranchId: Y, tvCode: await codes.get('tv', Y) });
      sockets.push(tvY.socket);
      expect(tvY.rooms).toEqual([`tv:${Y}`]);

      // kiosk kodi yangilansa — TV ga tegilmaydi
      await http().post(`/api/branches/${C}/kiosk-code`).set(bearer(admin)).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(tv.socket.connected).toBe(true);

      const kicked = new Promise<{ code: string }>((resolve) => tv.socket.once('auth_error', resolve));
      const gone = new Promise<void>((resolve) => tv.socket.once('disconnect', () => resolve()));
      const renewed = (await http().post(`/api/branches/${C}/tv-code`).set(bearer(admin)).expect(200)).body.code;
      expect(await kicked).toEqual({ code: 'wrong_tv_code' });
      await gone;
      // boshqa filial TV si ulanib turibdi
      expect(tvY.socket.connected).toBe(true);
      expect(await connect(url, { tvBranchId: C, tvCode: code })).toMatchObject({ rooms: null, code: 'wrong_tv_code' });
      const again = await connect(url, { tvBranchId: C, tvCode: renewed });
      sockets.push(again.socket);
      expect(again.rooms).toEqual([`tv:${C}`]);
    });
  });

  describe('kiosk', () => {
    it("admin: ko'rish va yangilash (`/kiosk-code`); boshqa rollar — yo'q", async () => {
      const shown = (await http().get(`/api/branches/${Y}/kiosk-code`).set(bearer(admin)).expect(200)).body.code as string;
      expect(shown).toMatch(/^\d{8}$/);
      expect((await http().get(`/api/branches/${Y}/kiosk-code`).set(bearer(admin)).expect(200)).body).toEqual({ code: shown });
      const renewed = (await http().post(`/api/branches/${Y}/kiosk-code`).set(bearer(admin)).expect(200)).body.code;
      expect(renewed).not.toBe(shown);

      await http().get('/api/branches/br_yoq/kiosk-code').set(bearer(admin)).expect(404);
      const cashier = (await http().post('/api/auth/login').send({ userId: 'usr_cashier_c1', pin: '1234' }).expect(200)).body.token;
      await http().get(`/api/branches/${Y}/kiosk-code`).set(bearer(cashier)).expect(403);
      await http().post(`/api/branches/${Y}/kiosk-code`).set(bearer(cashier)).expect(403);
      await http().get(`/api/branches/${Y}/kiosk-code`).expect(401);
    });

    it("buyurtma: kodsiz, noto'g'ri, boshqa filialniki yoki TV kodi bilan — wrong_kiosk_code (yozilmaydi); to'g'risi bilan — 201", async () => {
      const code = await codes.get('kiosk', C);
      const before = await db.manager.countBy(Order, { source: 'kiosk' });
      expect((await kioskOrder(C).expect(401)).body.code).toBe('wrong_kiosk_code');
      expect((await kioskOrder(C, '00000000').expect(401)).body.code).toBe('wrong_kiosk_code');
      expect((await kioskOrder(C, await codes.get('kiosk', Y)).expect(401)).body.code).toBe('wrong_kiosk_code');
      // TV kodi kioskni ochmaydi (va aksincha)
      expect((await kioskOrder(C, await codes.get('tv', C)).expect(401)).body.code).toBe('wrong_kiosk_code');
      expect((await queue(C, code).expect(401)).body.code).toBe('wrong_tv_code');
      expect((await kioskOrder('br_yoq', code).expect(401)).body.code).toBe('wrong_kiosk_code');
      expect(await db.manager.countBy(Order, { source: 'kiosk' })).toBe(before);

      const created = await kioskOrder(C, `${code.slice(0, 4)} ${code.slice(4)}`).expect(201);
      expect(created.body).toMatchObject({ branchId: C, status: 'pending', payment: null });
      // forma xatosi kod tekshiruvidan oldin
      expect((await http().post('/api/kiosk/orders').set('X-Kiosk-Code', code).send({ type: 'takeaway' }).expect(400)).body.code).toBe(
        'invalid_input',
      );
    });

    it("tekshiruv (`GET /kiosk/check`): to'g'ri — `{ ok: true }`; kodsiz / noto'g'ri — 401; yangilangach eskisi — 401", async () => {
      const code = await codes.get('kiosk', C);
      expect((await kioskCheck(C, code).expect(200)).body).toEqual({ ok: true });
      expect((await kioskCheck(C).expect(401)).body.code).toBe('wrong_kiosk_code');
      expect((await kioskCheck(C, '11111111').expect(401)).body.code).toBe('wrong_kiosk_code');
      expect((await http().get('/api/kiosk/check').set('X-Kiosk-Code', code).expect(400)).body.code).toBe('branch_required');

      const renewed = (await http().post(`/api/branches/${C}/kiosk-code`).set(bearer(admin)).expect(200)).body.code;
      expect((await kioskCheck(C, code).expect(401)).body.code).toBe('wrong_kiosk_code');
      expect((await kioskOrder(C, code).expect(401)).body.code).toBe('wrong_kiosk_code');
      await kioskCheck(C, renewed).expect(200);
      await kioskOrder(C, renewed).expect(201);
    });
  });

  it("filial o'chirilsa — TV va kiosk kodlari ham (offline kalit bilan birga)", async () => {
    const created = await http().post('/api/branches').set(bearer(admin)).send({ name: 'Sergeli', address: '', phone: '', active: true }).expect(201);
    const id = created.body.id as string;
    await http().get(`/api/branches/${id}/tv-code`).set(bearer(admin)).expect(200);
    await http().get(`/api/branches/${id}/kiosk-code`).set(bearer(admin)).expect(200);
    await http().get(`/api/branches/${id}/offline-key`).set(bearer(admin)).expect(200);
    await http().delete(`/api/branches/${id}`).set(bearer(admin)).expect(204);
    const keys = [`tv_code:${id}`, `kiosk_code:${id}`, `offline_key:${id}`];
    expect(await db.manager.countBy(Setting, { key: In(keys) })).toBe(0);
  });

  describe("noto'g'ri kod uchun blok yo'q (THROTTLE yoqiq ham)", () => {
    beforeAll(() => {
      process.env.THROTTLE = 'on';
    });

    afterAll(() => {
      process.env.THROTTLE = 'off';
    });

    it("bir IP dan ko'p xil noto'g'ri kod — har biri faqat wrong_*_code; to'g'ri kod darhol ishlaydi (REST, socket, kiosk)", async () => {
      const tv = await codes.get('tv', Y);
      const kiosk = await codes.get('kiosk', Y);
      for (let i = 1; i <= 30; i++) {
        expect((await queue(Y, String(i).padStart(8, '1')).expect(401)).body.code).toBe('wrong_tv_code');
        expect((await kioskCheck(Y, String(i).padStart(8, '2')).expect(401)).body.code).toBe('wrong_kiosk_code');
      }
      expect(await connect(url, { tvBranchId: Y, tvCode: '00000001' })).toMatchObject({ rooms: null, code: 'wrong_tv_code' });

      await queue(Y, tv).expect(200);
      await kioskCheck(Y, kiosk).expect(200);
      await kioskOrder(Y, kiosk).expect(201);
      const tvSocket = await connect(url, { tvBranchId: Y, tvCode: tv });
      sockets.push(tvSocket.socket);
      expect(tvSocket.rooms).toEqual([`tv:${Y}`]);
    });
  });
});
