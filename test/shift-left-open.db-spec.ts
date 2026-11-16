import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, IsNull } from 'typeorm';
import { Branch } from '../src/branches/branch.entity';
import type { ShiftClosed } from '../src/shifts/shift-events';
import { ShiftEvents } from '../src/shifts/shift-events';
import { Shift } from '../src/shifts/shift.entity';
import { seedDemo } from './fixtures/demo';
import { BRANCH_CHILONZOR as C, BRANCH_YUNUSOBOD as Y } from './fixtures/demo-data';
import { createTestApp } from './test-app';

/**
 * Kassir smenani topshirmay ketdi (2026-11-17): brauzerni «X» bilan yopib ketadi, keyingi kassir kirganda eslatilmasdi.
 * Endi kirish ekrani (`GET /auth/staff?branchId=`) kassirning shu filialdagi ochiq smenasini ko'rsatadi (`openShiftAt`),
 * boshqa kassir shu filialga PIN bilan kirganda u smena yopiladi — Telegram hisobotiga «avtomatik» belgisi bilan.
 */

const DILNOZA = 'usr_cashier_c1'; // PIN 1234, Chilonzor
const SARDOR = 'usr_cashier_c2'; // PIN 4321, Chilonzor
const MALIKA = 'usr_cashier_y1'; // PIN 1234, Yunusobod

describe('topshirilmagan smena — keyingi kassir kirganda yopiladi', () => {
  let app: INestApplication;
  let ds: DataSource;
  const events: ShiftClosed[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (userId: string, pin: string, branchId: string) =>
    http().post('/api/auth/login').send({ userId, pin, branchId });
  const openShift = (cashierId: string) => ds.manager.findOneBy(Shift, { cashierId, closedAt: IsNull() });
  const staffAt = async (branchId: string | null, role?: string) =>
    (
      await http()
        .get('/api/auth/staff')
        .query({ ...(branchId && { branchId }), ...(role && { role }) })
        .expect(200)
    ).body as { id: string; role: string; openShiftAt?: string | null }[];

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    app.get(ShiftEvents).onClosed((event) => events.push(event));
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await seedDemo(app, { activity: false });
    events.length = 0;
  });

  it("kirish ro'yxati: kassirda shu filialdagi ochiq smenasi vaqti, boshqalarda null; filialsiz so'rovda maydon yo'q", async () => {
    const opened = (await login(DILNOZA, '1234', C).expect(200)).body.shift as Shift;

    const atC = await staffAt(C);
    expect(atC.find((u) => u.id === DILNOZA)?.openShiftAt).toBe(new Date(opened.openedAt).toISOString());
    expect(atC.find((u) => u.id === SARDOR)?.openShiftAt).toBeNull();
    // oshpaz yordamchisida — maydon yo'q
    expect(atC.find((u) => u.role === 'kitchen')).not.toHaveProperty('openShiftAt');
    // boshqa filial ro'yxatida Chilonzordagi smena ko'rinmaydi
    expect((await staffAt(Y, 'cashier')).every((u) => u.openShiftAt === null)).toBe(true);
    expect((await staffAt(null, 'cashier'))[0]).not.toHaveProperty('openShiftAt');
  });

  it('Sardor kirdi — Dilnozaning smenasi shu payt yopiladi, Sardorniki ochiladi; hisobotda «avtomatik»', async () => {
    const dilnoza = (await login(DILNOZA, '1234', C).expect(200)).body.shift as Shift;
    const before = Date.now();
    const sardor = await login(SARDOR, '4321', C).expect(200);
    expect(sardor.body.shift).toMatchObject({ cashierId: SARDOR, branchId: C, closedAt: null });

    const closed = await ds.manager.findOneByOrFail(Shift, { id: dilnoza.id });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await openShift(DILNOZA)).toBeNull();
    expect(events).toEqual([
      { shiftId: dilnoza.id, closedBy: expect.objectContaining({ id: SARDOR }), auto: true },
    ]);

    // ro'yxatda endi faqat Sardorniki ochiq
    const atC = await staffAt(C, 'cashier');
    expect(atC.find((u) => u.id === DILNOZA)?.openShiftAt).toBeNull();
    expect(atC.find((u) => u.id === SARDOR)?.openShiftAt).not.toBeNull();
  });

  it("Dilnozaning o'zi qaytib kirsa — smenasi davom etadi, hech narsa yopilmaydi", async () => {
    const first = (await login(DILNOZA, '1234', C).expect(200)).body.shift as Shift;
    const again = (await login(DILNOZA, '1234', C).expect(200)).body.shift as Shift;
    expect(again.id).toBe(first.id);
    expect(events).toEqual([]);
  });

  it("kirish rad etilsa (noto'g'ri PIN, FaceID) — smena ochiq qoladi", async () => {
    const dilnoza = (await login(DILNOZA, '1234', C).expect(200)).body.shift as Shift;

    expect((await login(SARDOR, '0000', C).expect(401)).body.code).toBe('wrong_pin');
    await ds.manager.update(Branch, C, { faceIdRequired: true });
    expect((await login(SARDOR, '4321', C).expect(409)).body.code).toBe('faceid_checkin_required');

    expect((await openShift(DILNOZA))?.id).toBe(dilnoza.id);
    expect(await openShift(SARDOR)).toBeNull();
    expect(events).toEqual([]);
  });

  it('boshqa filialdagi smena, oshpaz yordamchisi kirishi, blokdan chiqish va POST /shifts/current — yopmaydi', async () => {
    const malika = (await login(MALIKA, '1234', Y).expect(200)).body.shift as Shift;
    const dilnoza = await login(DILNOZA, '1234', C).expect(200);
    expect((await openShift(MALIKA))?.id).toBe(malika.id);

    // oshpaz yordamchisi kirdi — Dilnozaning smenasi ochiq
    await login('usr_kitchen_c1', '1111', C).expect(200);
    expect(await openShift(DILNOZA)).not.toBeNull();

    // Sardor ilgari kirgan (tokeni bor), Dilnoza keyin kirdi — Sardorning smenasi yopildi; uning eski tabi blokdan
    // chiqsa yoki sotuvdan oldin smenani so'rasa — Dilnozanikiga tegmaydi
    const sardorToken = (await login(SARDOR, '4321', C).expect(200)).body.token as string;
    await login(DILNOZA, '1234', C).expect(200);
    expect(await openShift(SARDOR)).toBeNull();
    await http().post('/api/auth/unlock').set(bearer(sardorToken)).send({ pin: '4321' }).expect(200);
    await http().post('/api/shifts/current').set(bearer(sardorToken)).expect(200);
    expect(await openShift(SARDOR)).not.toBeNull();
    expect((await openShift(DILNOZA))?.id).not.toBe((dilnoza.body.shift as Shift).id);
    expect(await openShift(DILNOZA)).not.toBeNull();
    expect((await openShift(MALIKA))?.id).toBe(malika.id);
  });
});
