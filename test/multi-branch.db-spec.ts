import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Shift } from '../src/shifts/shift.entity';
import { OfflineKeysService } from '../src/sync/offline-keys.service';
import { User } from '../src/users/user.entity';
import { UsersService } from '../src/users/users.service';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C, BRANCH_YUNUSOBOD as Y } from './fixtures/demo-data';
import { createTestApp } from './test-app';

/**
 * Bir xodim — bir nechta filial (2026-11-04): kirishda kassa turgan filial tanlanadi va tokenga yoziladi; kassirda bir
 * vaqtda bitta ochiq smena — boshqa filialda ochiq qolgan bo'lsa kirish rad etiladi (`shift_open_elsewhere`, o'sha
 * filial nomi bilan); eski (filialsiz) tokenlar, blokdan chiqish, filialdan olib tashlash, offline kassa ro'yxati,
 * migratsiya (`StaffBranches`).
 */

const DILNOZA = 'usr_cashier_c1'; // PIN 1234, avval faqat Chilonzor
const AZIZ = 'usr_kitchen_c1'; // PIN 1111, avval faqat Chilonzor
const MIGRATION = 'StaffBranches1793740000000';

function connect(url: string, token: string): Promise<{ socket: Socket; rooms: string[] | null }> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error("socket: javob yo'q")), 5000);
    socket.on('ready', (data: { rooms: string[] }) => {
      clearTimeout(timer);
      resolve({ socket, rooms: data.rooms });
    });
    socket.on('auth_error', () => {
      clearTimeout(timer);
      resolve({ socket, rooms: null });
    });
  });
}

describe('bir xodim — bir nechta filial', () => {
  let app: INestApplication;
  let ds: DataSource;
  let url: string;
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (userId: string, pin: string, branchId?: string) =>
    http()
      .post('/api/auth/login')
      .send({ userId, pin, ...(branchId && { branchId }) });
  const tokenAt = async (userId: string, pin: string, branchId?: string) =>
    (await login(userId, pin, branchId).expect(200)).body.token as string;
  const me = (token: string) => http().get('/api/auth/me').set(bearer(token));
  const staffAt = async (branchId: string, role = 'cashier') =>
    ((await http().get('/api/auth/staff').query({ branchId, role }).expect(200)).body as { id: string }[]).map(
      (u) => u.id,
    );
  const saveUser = (id: string, patch: Partial<Parameters<UsersService['save']>[0]>) =>
    ds.manager.findOneByOrFail(User, { id }).then((user) =>
      app.get(UsersService).save(
        { id, name: user.name, surname: user.surname, role: user.role, branchIds: user.branchIds, active: true, ...patch },
        'usr_admin',
      ),
    );
  const openShifts = () => ds.manager.findBy(Shift, { cashierId: DILNOZA }).then((all) => all.filter((s) => !s.closedAt));

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  });

  describe('admin xodimni ikki filialga biriktiradi', () => {
    beforeAll(async () => {
      await seedDemo(app, { activity: false });
    });

    it("bir nechta filial saqlanadi, takrorlari olib tashlanadi; noma'lum filial — not_found, bo'sh — branch_required", async () => {
      const admin = (await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token as string;
      const body = { name: 'Dilnoza', surname: 'Karimova', role: 'cashier', pin: '', active: true };
      const saved = await http()
        .patch(`/api/users/${DILNOZA}`)
        .set(bearer(admin))
        .send({ ...body, branchIds: [C, Y, C] })
        .expect(200);
      expect(saved.body.branchIds).toEqual([C, Y]);
      expect(saved.body.branchId).toBeUndefined();

      const unknown = await http().patch(`/api/users/${DILNOZA}`).set(bearer(admin)).send({ ...body, branchIds: [C, 'br_yoq'] });
      expect(unknown.body.code).toBe('not_found');
      const empty = await http().patch(`/api/users/${DILNOZA}`).set(bearer(admin)).send({ ...body, branchIds: [] });
      expect(empty.body.code).toBe('branch_required');
      expect((await ds.manager.findOneByOrFail(User, { id: DILNOZA })).branchIds).toEqual([C, Y]);

      // ro'yxat GET /users da ham
      const list = (await http().get('/api/users').set(bearer(admin)).expect(200)).body as User[];
      expect(list.find((u) => u.id === DILNOZA)?.branchIds).toEqual([C, Y]);
    });

    it("kirish ekrani: har ikki filial ro'yxatida chiqadi", async () => {
      expect(await staffAt(C)).toContain(DILNOZA);
      expect(await staffAt(Y)).toContain(DILNOZA);
      // boshqa kassirlar — faqat o'z filialida
      expect(await staffAt(Y)).not.toContain('usr_cashier_c2');
    });

    it('offline kassa nusxasida — har ikki filial kassirlari orasida', async () => {
      for (const branch of [C, Y]) {
        const key = await app.get(OfflineKeysService).get(branch);
        const snapshot = await http().get('/api/sync/snapshot').set({ 'x-offline-key': key }).expect(200);
        expect((snapshot.body.cashiers as { id: string }[]).map((c) => c.id)).toContain(DILNOZA);
      }
    });

    it("filialni o'chirib bo'lmaydi — unda xodim bor (in_use)", async () => {
      const admin = (await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(200)).body.token as string;
      const res = await http().delete(`/api/branches/${Y}`).set(bearer(admin)).expect(409);
      expect(res.body).toMatchObject({ code: 'in_use' });
    });
  });

  describe('kirish va smena', () => {
    beforeAll(async () => {
      await seedDemo(app, { activity: false });
      await saveUser(DILNOZA, { branchIds: [C, Y] });
    });

    it('filial tanlanmasa — branch_required (bir nechta filial), biriktirilmagan filial — forbidden', async () => {
      expect((await login(DILNOZA, '1234').expect(400)).body.code).toBe('branch_required');
      expect((await login('usr_cashier_c2', '4321', Y).expect(403)).body.code).toBe('forbidden');
      // bitta filialli xodim — eski ilova kabi filialsiz ham kiradi
      expect((await login('usr_cashier_c2', '4321').expect(200)).body.user).toMatchObject({ branchId: C, branchIds: [C] });
      expect(await openShifts()).toHaveLength(0);
    });

    it('Chilonzorda kiradi: token, smena va buyurtma — Chilonzorniki', async () => {
      const res = await login(DILNOZA, '1234', C).expect(200);
      expect(res.body.user).toMatchObject({ id: DILNOZA, branchId: C, branchIds: [C, Y] });
      expect(res.body.shift).toMatchObject({ branchId: C, closedAt: null });
      const token = res.body.token as string;
      expect((await me(token).expect(200)).body).toMatchObject({ user: { branchId: C }, shift: { id: res.body.shift.id } });

      const order = await http()
        .post('/api/orders')
        .set(bearer(token))
        .send({ type: 'dine_in', items: [{ productId: 'burger-classic', qty: 1 }], payment: 'cash' })
        .expect(201);
      expect(order.body).toMatchObject({ branchId: C, shiftId: res.body.shift.id });
    });

    it("Chilonzorda smena ochiq — Yunusobodda kira olmaydi (shift_open_elsewhere, filial nomi bilan); PIN xatosi sanalmaydi", async () => {
      const res = await login(DILNOZA, '1234', Y).expect(409);
      expect(res.body).toMatchObject({ code: 'shift_open_elsewhere', detail: 'Chilonzor' });
      expect(await openShifts()).toEqual([expect.objectContaining({ branchId: C })]);
      const [row] = (await ds.query(`SELECT "failedPinAttempts" AS failed FROM users WHERE id = $1`, [DILNOZA])) as {
        failed: number;
      }[];
      expect(row.failed).toBe(0);
      // noto'g'ri PIN — avval PIN tekshiriladi (smena haqida hech narsa aytilmaydi)
      expect((await login(DILNOZA, '9999', Y).expect(401)).body.code).toBe('wrong_pin');
    });

    it('Chilonzorda smenani topshirgach — Yunusobodda kiradi, yangi smena va buyurtma Yunusobodniki', async () => {
      const chilonzor = await tokenAt(DILNOZA, '1234', C);
      await http().post('/api/shifts/current/close').set(bearer(chilonzor)).expect(200);

      const res = await login(DILNOZA, '1234', Y).expect(200);
      expect(res.body.shift).toMatchObject({ branchId: Y, closedAt: null });
      const token = res.body.token as string;
      const order = await http()
        .post('/api/orders')
        .set(bearer(token))
        .send({ type: 'takeaway', items: [{ productId: 'burger-classic', qty: 1 }], payment: 'card' })
        .expect(201);
      expect(order.body).toMatchObject({ branchId: Y, shiftId: res.body.shift.id });
      expect((await http().get('/api/orders/active').set(bearer(token)).expect(200)).body.map((o: { branchId: string }) => o.branchId)).toEqual(
        expect.arrayContaining([Y]),
      );

      // eski Chilonzor tabi: smena yo'q, yangisini ham ocha olmaydi — Yunusobodda ochiq
      expect((await me(chilonzor).expect(200)).body.shift).toBeNull();
      const reopen = await http().post('/api/shifts/current').set(bearer(chilonzor)).expect(409);
      expect(reopen.body).toMatchObject({ code: 'shift_open_elsewhere', detail: 'Yunusobod' });
    });

    it('blokdan chiqish — token o\'sha filial bilan qoladi', async () => {
      const token = await tokenAt(DILNOZA, '1234', Y);
      const unlocked = (await http().post('/api/auth/unlock').set(bearer(token)).send({ pin: '1234' }).expect(200)).body
        .token as string;
      expect((await me(unlocked).expect(200)).body.user).toMatchObject({ branchId: Y });
    });

    it("eski (filialsiz) token: bitta filialli xodimda ishlaydi, bir nechta filialli xodimda — 401", async () => {
      const secret = (app.get(DataSource).manager.query(`SELECT value FROM settings WHERE key = 'jwtSecret'`) as Promise<
        { value: string }[]
      >).then((rows) => process.env.JWT_SECRET?.trim() || rows[0].value);
      const oldToken = async (sub: string) => app.get(JwtService).signAsync({ sub }, { secret: await secret, expiresIn: '1h' });

      expect((await me(await oldToken('usr_cashier_c2')).expect(200)).body.user).toMatchObject({ branchId: C });
      await me(await oldToken(DILNOZA)).expect(401);
      // filialsiz rol — farqi yo'q
      expect((await me(await oldToken('usr_supplier')).expect(200)).body.user).toMatchObject({ branchId: null, branchIds: [] });
    });
  });

  describe('admin xodimni filialdan olib tashlaydi', () => {
    beforeAll(async () => {
      await seedDemo(app, { activity: false });
      await saveUser(AZIZ, { branchIds: [C, Y] });
    });

    it("faqat o'sha filialdagi sessiya va socket uziladi; qolgan filialdagisi ishlayveradi", async () => {
      const atC = await tokenAt(AZIZ, '1111', C);
      const atY = await tokenAt(AZIZ, '1111', Y);
      const c = await connect(url, atC);
      const y = await connect(url, atY);
      sockets.push(c.socket, y.socket);
      expect(c.rooms).toEqual([`branch:${C}`]);
      expect(y.rooms).toEqual([`branch:${Y}`]);

      const yKicked = new Promise<void>((resolve) => y.socket.once('disconnect', () => resolve()));
      let cKicked = false;
      c.socket.once('disconnect', () => (cKicked = true));
      await saveUser(AZIZ, { branchIds: [C] });
      await yKicked;
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(cKicked).toBe(false);

      await me(atY).expect(401);
      expect((await me(atC).expect(200)).body.user).toMatchObject({ branchId: C, branchIds: [C] });
      // Yunusobodga endi kira olmaydi
      expect((await login(AZIZ, '1111', Y).expect(403)).body.code).toBe('forbidden');
    });

    it("yangi filial qo'shilsa — hech kim uzilmaydi", async () => {
      const atC = await tokenAt(AZIZ, '1111', C);
      const c = await connect(url, atC);
      sockets.push(c.socket);
      let kicked = false;
      c.socket.once('disconnect', () => (kicked = true));
      await saveUser(AZIZ, { branchIds: [C, Y] });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(kicked).toBe(false);
      await me(atC).expect(200);
    });
  });

  describe('migratsiya (StaffBranches)', () => {
    it("filial ro'yxatga ko'chadi; bir kassirning ikki filialdagi ochiq smenasidan eskisi yopiladi", async () => {
      await seedDemo(app, { activity: false });
      // StaffBranches va undan keyingilar qaytariladi (keyin hammasi qayta bajariladi)
      for (;;) {
        const [last] = (await ds.query(`SELECT name FROM migrations ORDER BY id DESC LIMIT 1`)) as { name: string }[];
        await ds.undoLastMigration();
        if (last.name === MIGRATION) break;
      }
      const [{ branchId }] = (await ds.query(`SELECT "branchId" FROM users WHERE id = $1`, [DILNOZA])) as {
        branchId: string;
      }[];
      expect(branchId).toBe(C);
      // eski qoida: har filialda bittadan — admin smena ochiq turganda filialni almashtirgan
      await ds.query(
        `INSERT INTO shifts (id, "branchId", "cashierId", "openedAt", "closedAt") VALUES
           ('shf_old', $1, $3, '2026-11-01T08:00:00Z', NULL),
           ('shf_new', $2, $3, '2026-11-01T12:00:00Z', NULL),
           ('shf_other', $2, 'usr_cashier_y1', '2026-11-01T09:00:00Z', NULL)`,
        [C, Y, DILNOZA],
      );
      await ds.runMigrations();

      expect((await ds.manager.findOneByOrFail(User, { id: DILNOZA })).branchIds).toEqual([C]);
      expect((await ds.manager.findOneByOrFail(User, { id: 'usr_admin' })).branchIds).toEqual([]);
      const shifts = await ds.manager.find(Shift, { order: { id: 'ASC' } });
      expect(shifts.map((s) => [s.id, s.closedAt?.toISOString() ?? null])).toEqual([
        ['shf_new', null],
        ['shf_old', '2026-11-01T12:00:00.000Z'],
        ['shf_other', null],
      ]);
      // yangi indeks: kassirda ikkinchi ochiq smena bo'lmaydi
      await expect(
        ds.query(`INSERT INTO shifts (id, "branchId", "cashierId", "openedAt") VALUES ('shf_x', $1, $2, now())`, [C, DILNOZA]),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
