import type { INestApplication } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { SaveDeliveryDto, WorkHoursDto } from '../src/branches/branch.dto';
import { BranchesService } from '../src/branches/branches.service';
import type { LatLng } from '../src/common/types';
import { seedDemo } from './fixtures/demo';
import { Order } from '../src/orders/order.entity';
import { OrdersService } from '../src/orders/orders.service';
import { Shift } from '../src/shifts/shift.entity';
import { ShiftsService } from '../src/shifts/shifts.service';
import { actor, createTestApp, expectCode } from './test-app';

/**
 * Online (mobil) buyurtma: filial holati, dostavka manzili bo'yicha filial (frontend `routeDelivery` /
 * `branchOnlineState` / `saveDelivery` — `logic-smoke.ts` dagi demo baza holatlari), backendning ish vaqti va 5 daqiqalik
 * qabul muddati, `createByMobile` tekshiruvlari. Sof geometriya va `routeDelivery` ning o'zi — `src/domain/domain.spec.ts`.
 * `insertPoint` (xaritada nuqta qo'shish) — faqat frontend UI yordamchisi, backendda yo'q.
 */

const now = new Date('2026-10-23T12:00:00');
const C = 'br_chilonzor';
const Y = 'br_yunusobod';
const IN_CHILONZOR = { lat: 41.28, lng: 69.2 };
const IN_YUNUSOBOD = { lat: 41.36, lng: 69.29 };
/** Toshkent markazi — hech qaysi hududda emas, Yunusobod yaqinroq */
const CENTER = { lat: 41.3111, lng: 69.2797 };
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

const admin = actor('usr_admin', 'admin');
const c1 = actor('usr_cashier_c1', 'cashier', C);
const y1 = actor('usr_cashier_y1', 'cashier', Y);

const items = [{ productId: 'burger-classic', qty: 1 }];
const online = {
  platform: 'android',
  name: 'Vali',
  phone: '+998 91 111 11 11',
  address: 'Chilonzor 9',
  payment: 'cash',
} as const;

describe('online buyurtma: filial tanlash, ish vaqti, qabul muddati', () => {
  let app: INestApplication;
  let em: EntityManager;
  let branches: BranchesService;
  let orders: OrdersService;
  let shifts: ShiftsService;

  beforeAll(async () => {
    app = await createTestApp();
    em = app.get(DataSource).manager;
    branches = app.get(BranchesService);
    orders = app.get(OrdersService);
    shifts = app.get(ShiftsService);
  });

  afterAll(() => app.close());

  const stateOf = async (branchId: string, at = now) => (await branches.findOne(branchId, at)).onlineState;
  const route = (point: LatLng, at = now) => branches.route(point, at);
  const findOrder = (id: string) => em.findOneByOrFail(Order, { id });
  /** Filialning hozirgi yetkazib berish sozlamalari — saqlash buyrug'i ko'rinishida (frontend `deliveryOf`). */
  const deliveryOf = async (branchId: string): Promise<SaveDeliveryDto> => {
    const b = await branches.get(em, branchId);
    return {
      location: b.location,
      zone: b.deliveryZone,
      fee: b.deliveryFee,
      fallbackBranchId: b.fallbackBranchId,
      onlineEnabled: b.onlineEnabled,
    };
  };
  const closeShifts = async (branchId: string, at = now) => {
    for (const shift of await em.findBy(Shift, { branchId, closedAt: IsNull() }))
      await shifts.close(shift.id, at);
  };
  const delivery = (location: LatLng | null, at = now, branchId?: string) =>
    orders.createByMobile({ type: 'delivery', branchId, items, online: { ...online, location } }, at);
  const takeaway = (branchId: string | undefined, at = now) =>
    orders.createByMobile({ type: 'takeaway', branchId, items, online }, at);

  describe("yetkazib berish: hudud → filial, yopiq bo'lsa zaxira, hududdan tashqarida — eng yaqin ochiq (jonli demo)", () => {
    // demo bazada ikkala filialda smena ochiq (kassa sharti testda o'chiq)
    beforeEach(() => seedDemo(app, { activity: true }, now));

    it("hudud ichida — o'sha filial, hudud narxi bilan; hududdan tashqarida — eng yaqin, narxsiz", async () => {
      expect((await branches.findAll(now)).map((b) => [b.id, b.onlineState])).toEqual([
        [C, 'open'],
        [Y, 'open'],
      ]);
      expect(await route(IN_CHILONZOR)).toEqual({
        branchId: C,
        zoneBranchId: C,
        fee: 10_000,
        redirected: false,
      });
      expect(await route(IN_YUNUSOBOD)).toEqual({
        branchId: Y,
        zoneBranchId: Y,
        fee: 12_000,
        redirected: false,
      });
      // markazdan Yunusobod yaqinroq
      expect(await route(CENTER)).toEqual({ branchId: Y, zoneBranchId: null, fee: null, redirected: false });
      await expectCode('invalid_location', () => route({ lat: 100, lng: 69 }));
    });

    it("admin to'xtatdi → zaxira filialga, narx — hudud narxi", async () => {
      await branches.setOnline(C, false);
      expect(await stateOf(C)).toBe('paused');
      expect(await route(IN_CHILONZOR)).toEqual({
        branchId: Y,
        zoneBranchId: C,
        fee: 10_000,
        redirected: true,
      });
      expect((await route(CENTER)).branchId).toBe(Y);
      await branches.setOnline(C, true);
      expect(await stateOf(C)).toBe('open');
      expect((await route(IN_CHILONZOR)).branchId).toBe(C);
    });

    it("smena yopilsa ham zaxiraga; hech kim ochiq bo'lmasa — qabul qilinmaydi", async () => {
      await closeShifts(C);
      expect(await stateOf(C)).toBe('no_shift');
      expect((await route(IN_CHILONZOR)).branchId).toBe(Y);
      await branches.setOnline(Y, false);
      expect(await route(IN_CHILONZOR)).toEqual({
        branchId: null,
        zoneBranchId: C,
        fee: 10_000,
        redirected: true,
      });
      expect((await route(CENTER)).branchId).toBeNull();
    });

    it("zaxira filial eng yaqindan ustun; zaxirasiz — eng yaqin ochiq; hududlar ustma-ust — eng yaqini; faol bo'lmagan filial hududi hisobga olinmaydi", async () => {
      const sergeli = await branches.create({ name: 'Sergeli', address: '', phone: '', active: true }, now);
      expect(sergeli.onlineEnabled).toBe(true);
      expect(sergeli.deliveryZone).toEqual([]);
      const S = sergeli.id;
      await shifts.openOrResume('usr_cashier_c1', S, now);
      const sergeliDelivery: SaveDeliveryDto = {
        location: { lat: 41.275, lng: 69.21 },
        zone: [],
        fee: 0,
        fallbackBranchId: null,
        onlineEnabled: true,
      };
      await branches.saveDelivery(S, sergeliDelivery);
      expect(await stateOf(S)).toBe('open');

      await branches.setOnline(C, false);
      // Chilonzorning zaxirasi — Yunusobod (Sergeli yaqinroq bo'lsa ham)
      expect((await route(IN_CHILONZOR)).branchId).toBe(Y);
      const paused = await deliveryOf(C);
      await branches.saveDelivery(C, { ...paused, fallbackBranchId: null });
      expect((await route(IN_CHILONZOR)).branchId).toBe(S); // zaxirasiz — eng yaqin ochiq (Sergeli)
      // frontendda keyingi qadam to'xtatilmagan nusxadan — qaytaramiz
      await branches.saveDelivery(C, { ...paused, onlineEnabled: true });

      const square = [
        { lat: 41.26, lng: 69.19 },
        { lat: 41.26, lng: 69.23 },
        { lat: 41.29, lng: 69.23 },
        { lat: 41.29, lng: 69.19 },
      ];
      await branches.saveDelivery(S, { ...sergeliDelivery, zone: square });
      const overlapPoint = { lat: 41.276, lng: 69.208 };
      expect(await route(overlapPoint)).toEqual({ branchId: S, zoneBranchId: S, fee: 0, redirected: false });
      expect((await route({ lat: 41.29, lng: 69.17 })).branchId).toBe(C); // faqat Chilonzor hududida

      await branches.update(S, { name: 'Sergeli', address: '', phone: '', active: false });
      expect(await stateOf(S)).toBe('inactive');
      expect((await route(overlapPoint)).branchId).toBe(C);
    });

    it("sozlamalarni saqlash: tekshiruvlar, koordinatalar yaxlitlanadi, bo'sh hudud — mumkin", async () => {
      const base = await deliveryOf(Y);
      await expectCode('zone_too_small', () =>
        branches.saveDelivery(Y, { ...base, zone: base.zone.slice(0, 2) }),
      );
      await expectCode('invalid_amount', () => branches.saveDelivery(Y, { ...base, fee: -1 }));
      await expectCode('invalid_amount', () => branches.saveDelivery(Y, { ...base, fee: 1.5 }));
      await expectCode('invalid_location', () =>
        branches.saveDelivery(Y, { ...base, location: { lat: 100, lng: 69 } }),
      );
      await expectCode('invalid_location', () =>
        branches.saveDelivery(Y, { ...base, zone: [...base.zone.slice(1), { lat: 41.3, lng: 181 }] }),
      );
      // zaxira — o'zi bo'lmaydi; noma'lum filial
      await expectCode('not_found', () => branches.saveDelivery(Y, { ...base, fallbackBranchId: Y }));
      await expectCode('not_found', () =>
        branches.saveDelivery(Y, { ...base, fallbackBranchId: 'br_missing' }),
      );
      await expectCode('not_found', () => branches.saveDelivery('br_missing', base));
      expect(await deliveryOf(Y)).toEqual(base); // xatoda hech narsa saqlanmaydi

      const rounded = await branches.saveDelivery(Y, {
        ...base,
        location: { lat: 41.123456789, lng: 69.987654321 },
        zone: [
          { lat: 41.1234567, lng: 69.1 },
          { lat: 41.2, lng: 69.2345678 },
          { lat: 41.3, lng: 69.3 },
        ],
      });
      expect(rounded.location).toEqual({ lat: 41.123457, lng: 69.987654 });
      expect(rounded.deliveryZone).toEqual([
        { lat: 41.123457, lng: 69.1 },
        { lat: 41.2, lng: 69.234568 },
        { lat: 41.3, lng: 69.3 },
      ]);

      const noZone = await branches.saveDelivery(Y, { ...base, zone: [] });
      expect(noZone.deliveryZone).toEqual([]);
      expect((await route(IN_YUNUSOBOD)).zoneBranchId).toBeNull(); // hudud o'chirilsa — hududdan tashqarida
    });
  });

  describe('ish vaqti (faqat backend)', () => {
    const at = (time: string, day = '2026-10-23') => new Date(`${day}T${time}:00`);
    const setWorkHours = async (workHours: WorkHoursDto | null) => {
      const b = await branches.get(em, C);
      return branches.update(C, {
        name: b.name,
        address: b.address,
        phone: b.phone,
        active: b.active,
        workHours,
      });
    };
    const expectStates = async (cases: [Date, string][]) => {
      for (const [when, state] of cases) expect([when, await stateOf(C, when)]).toEqual([when, state]);
    };

    beforeAll(async () => {
      await seedDemo(app, { activity: false }, now);
      await shifts.openOrResume('usr_cashier_c1', C, at('08:00'));
      await shifts.openOrResume('usr_cashier_y1', Y, at('08:00'));
    });

    it('10:00–23:00: 09:00 da off_hours, 12:00 da open; ochilish soati kiradi, yopilishi kirmaydi', async () => {
      const saved = await setWorkHours({ open: '10:00', close: '23:00' });
      expect(saved.workHours).toEqual({ open: '10:00', close: '23:00' });
      await expectStates([
        [at('09:00'), 'off_hours'],
        [at('09:59'), 'off_hours'],
        [at('10:00'), 'open'],
        [at('12:00'), 'open'],
        [at('22:59'), 'open'],
        [at('23:00'), 'off_hours'],
      ]);
      expect(await stateOf(Y, at('09:00'))).toBe('open'); // boshqa filialga ta'sir qilmaydi
    });

    it("yarim tundan o'tadigan: 18:00–03:00", async () => {
      await setWorkHours({ open: '18:00', close: '03:00' });
      await expectStates([
        [at('12:00'), 'off_hours'],
        [at('17:59'), 'off_hours'],
        [at('18:00'), 'open'],
        [at('23:30'), 'open'],
        [at('02:59', '2026-10-24'), 'open'],
        [at('03:00', '2026-10-24'), 'off_hours'],
      ]);
    });

    it('open = close — invalid_input, eski ish vaqti qoladi', async () => {
      await expectCode('invalid_input', () => setWorkHours({ open: '10:00', close: '10:00' }));
      expect((await branches.get(em, C)).workHours).toEqual({ open: '18:00', close: '03:00' });
      await expectCode('invalid_input', () =>
        branches.create(
          {
            name: 'Sergeli',
            address: '',
            phone: '',
            active: true,
            workHours: { open: '09:00', close: '09:00' },
          },
          now,
        ),
      );
    });

    it('ish vaqtidan tashqarida: olib ketish — branch_closed, dostavka — zaxira filialga; kassa ishlayveradi', async () => {
      await setWorkHours({ open: '10:00', close: '23:00' });
      const morning = at('09:00');
      await expectCode('branch_closed', () => takeaway(C, morning));
      expect((await delivery(IN_CHILONZOR, morning)).order.branchId).toBe(Y);
      expect((await takeaway(C, at('12:00'))).order.branchId).toBe(C);
      // ish vaqti faqat online buyurtmaga ta'sir qiladi
      const cashier = await orders.createByCashier(c1, { type: 'dine_in', items, payment: 'cash' }, morning);
      expect(cashier.status).toBe('preparing');
    });

    it('workHours: null — 24/7', async () => {
      const saved = await setWorkHours(null);
      expect(saved.workHours).toBeNull();
      await expectStates([
        [at('03:00'), 'open'],
        [at('09:00'), 'open'],
        [at('23:30'), 'open'],
      ]);
      expect((await takeaway(C, at('03:00'))).order.branchId).toBe(C);
    });
  });

  describe('mobil buyurtma: 5 daqiqalik qabul muddati (jonli demo, ikki filial)', () => {
    /** Filialning bugungi oxirgi buyurtma raqami. */
    const lastNumber = async (branchId: string): Promise<number> => {
      const [row] = (await em.query(
        `SELECT COALESCE(MAX(number), 0)::int AS n FROM orders WHERE "branchId" = $1 AND "createdAt" >= $2`,
        [branchId, new Date('2026-10-23T00:00:00')],
      )) as { n: number }[];
      return row.n;
    };

    beforeEach(async () => {
      await seedDemo(app, { activity: true }, now);
      // demodagi qabul kutayotgan mobil buyurtma (1 daqiqa oldin) hisob-kitobga aralashmasin
      const pending = await em.findBy(Order, { source: 'mobile', status: 'pending' });
      expect(pending).toHaveLength(1);
      await orders.cancel(pending[0].id, admin, now);
    });

    it('dostavka qabul qilinmasa — Yunusobodga yangi raqam bilan (bir marta), yana 5 daqiqadan keyin bekor; olib ketish — bekor', async () => {
      // filialni server tanlaydi — yuborilgan Yunusobod e'tiborga olinmaydi
      const { order, trackingToken } = await delivery(IN_CHILONZOR, now, Y);
      expect(order).toMatchObject({ branchId: C, status: 'pending', transferCount: 0, fromBranchId: null });
      const pickup = (await takeaway(C)).order;

      // 4 daqiqa — hali kutadi
      expect(await orders.expirePendingMobile(later(4))).toBe(0);
      expect(await findOrder(order.id)).toMatchObject({
        branchId: C,
        number: order.number,
        transferCount: 0,
      });

      const yLast = await lastNumber(Y);
      expect(await orders.expirePendingMobile(later(6))).toBe(2);
      const moved = await findOrder(order.id);
      expect(moved).toMatchObject({
        branchId: Y,
        number: yLast + 1,
        status: 'pending',
        transferCount: 1,
        fromBranchId: C,
        cancelReason: null,
      });
      expect(moved.routedAt).toEqual(later(6));
      expect(moved.createdAt).toEqual(now);
      // mijoz ko'radi; endi Yunusobod kassasida, Chilonzorda — yo'q
      expect(await orders.track(order.id, trackingToken)).toMatchObject({
        branchId: Y,
        number: yLast + 1,
        transferCount: 1,
        fromBranchId: C,
        status: 'pending',
      });
      expect((await orders.active(Y)).some((o) => o.id === order.id)).toBe(true);
      expect((await orders.active(C)).some((o) => o.id === order.id)).toBe(false);
      // olib ketishni mijoz filialni o'zi tanlagan — boshqasiga o'tkazilmaydi
      expect(await findOrder(pickup.id)).toMatchObject({
        branchId: C,
        status: 'cancelled',
        cancelReason: 'timeout',
        cancelledBy: null,
        cancelledAt: later(6),
      });
      // Yunusobodning navbati davom etadi
      const next = await orders.createByCashier(y1, { type: 'dine_in', items, payment: 'cash' }, later(7));
      expect(next.number).toBe(yLast + 2);

      // Yunusobod ham 5 daqiqada qabul qilmadi — ikkinchi marta o'tkazilmaydi
      expect(await orders.expirePendingMobile(later(10))).toBe(0);
      expect(await orders.expirePendingMobile(later(12))).toBe(1);
      expect(await findOrder(order.id)).toMatchObject({
        branchId: Y,
        status: 'cancelled',
        cancelReason: 'timeout',
        transferCount: 1,
        cancelledAt: later(12),
      });
      expect(await orders.expirePendingMobile(later(30))).toBe(0);
    });

    it("Chilonzor smenalari yopilsa — muddati o'tmagan buyurtma ham darhol o'tadi; o'tkazadigan ochiq filial yo'q — no_branch", async () => {
      const first = (await delivery(IN_CHILONZOR)).order;
      const pickup = (await takeaway(C)).order;
      expect(first.branchId).toBe(C);
      await closeShifts(C);
      expect(await stateOf(C)).toBe('no_shift');

      expect(await orders.expirePendingMobile(later(1))).toBe(2);
      expect(await findOrder(first.id)).toMatchObject({
        branchId: Y,
        status: 'pending',
        transferCount: 1,
        fromBranchId: C,
        routedAt: later(1),
      });
      expect(await findOrder(pickup.id)).toMatchObject({
        status: 'cancelled',
        cancelReason: 'branch_closed',
      });

      // Chilonzor qayta ochildi, yangi buyurtma oldi va yana yopildi; Yunusobod ham to'xtatildi
      await shifts.openOrResume('usr_cashier_c1', C, later(1));
      const second = (await delivery(IN_CHILONZOR, later(1))).order;
      expect(second.branchId).toBe(C);
      await closeShifts(C, later(2));
      await branches.setOnline(Y, false);

      expect(await orders.expirePendingMobile(later(2))).toBe(2);
      expect(await findOrder(second.id)).toMatchObject({
        branchId: C,
        status: 'cancelled',
        cancelReason: 'no_branch',
        transferCount: 0,
      });
      // birinchisi allaqachon bir marta o'tkazilgan — Yunusobod yopilgach bekor
      expect(await findOrder(first.id)).toMatchObject({
        branchId: Y,
        status: 'cancelled',
        cancelReason: 'branch_closed',
      });
    });
  });

  describe('mobil buyurtma tekshiruvlari: createByMobile (jonli demo)', () => {
    beforeAll(() => seedDemo(app, { activity: true }, now));

    it("dostavka: joylashuvsiz — location_required; filialni server tanlaydi, yuborilgan branchId e'tiborga olinmaydi", async () => {
      await expectCode('location_required', () =>
        orders.createByMobile({ type: 'delivery', branchId: C, items, online }, now),
      );
      await expectCode('location_required', () => delivery(null));
      await expectCode('invalid_location', () => delivery({ lat: 100, lng: 69 }));

      // hech qaysi hududda emas — eng yaqin ochiq filial
      const outside = (await delivery(CENTER, now, C)).order;
      expect(outside).toMatchObject({ branchId: Y, total: 32000, status: 'pending' });
      expect(outside.online?.location).toEqual(CENTER);
      const inside = (await delivery(IN_CHILONZOR, now, Y)).order;
      expect(inside).toMatchObject({ branchId: C, total: 32000 });

      // olib ketishda filialni mijoz tanlaydi
      await expectCode('branch_required', () => takeaway(undefined));
      await expectCode('not_found', () => takeaway('br_missing'));
      await expectCode('invalid_status', () =>
        orders.createByMobile({ type: 'dine_in', branchId: C, items, online }, now),
      );
    });

    it('hech bir filial ochiq emas — branch_closed, buyurtma yozilmaydi', async () => {
      await branches.setOnline(Y, false);
      expect((await delivery(CENTER)).order.branchId).toBe(C); // eng yaqini yopiq — keyingi ochiq
      await branches.setOnline(C, false);
      const count = await em.count(Order);
      await expectCode('branch_closed', () => delivery(IN_CHILONZOR));
      await expectCode('branch_closed', () => delivery(CENTER));
      await expectCode('branch_closed', () => takeaway(C));
      expect(await em.count(Order)).toBe(count);
    });
  });
});
