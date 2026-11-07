/**
 * Demo uchun "jonli" ma'lumot — ReactJS_NYFF `src/data/history.ts` dan ko'chirilgan: o'tgan 30 kun savdosi (hisobotlar
 * bo'sh turmasin), bugungi buyurtmalar (kassa va TV da darhol ko'rinadi), kirim / ko'chirish hujjatlari va kommunal
 * to'lovlar. Tasodifiy, lekin har safar bir xil (o'zgarmas urug'li generator) — frontend bilan bir xil manzara chiqishi
 * uchun `rand()` chaqiruvlari tartibi aynan frontenddagidek.
 *
 * Tarix (buyurtma va smenalar) frontenddagidek to'g'ridan-to'g'ri yoziladi — omborga tegmaydi. Hujjatlar, bugungi
 * buyurtmalar va chiqimlar haqiqiy servislar orqali (ombordan ayriladi, raqamlar navbatda).
 */
import type { AuthUser } from '../../src/auth/auth.types';
import type { ExpenseKind, OrderSource, OrderType, PaymentMethod } from '../../src/common/enums';
import { newId } from '../../src/common/ids';
import type { OnlineInfo, OrderItem } from '../../src/common/types';
import type { Counter } from '../../src/database/counters';
import { addDays, dateKey, parseDateKey } from '../../src/domain/dates';
import type { ExpensesService } from '../../src/expenses/expenses.service';
import { soldAt, type Product } from '../../src/menu/product.entity';
import { NO_COURIER, type Order } from '../../src/orders/order.entity';
import type { OrdersService } from '../../src/orders/orders.service';
import type { Shift } from '../../src/shifts/shift.entity';
import type { ShiftsService } from '../../src/shifts/shifts.service';
import type { WarehouseService } from '../../src/warehouse/warehouse.service';
import { WAREHOUSE_CENTRAL, ZONE_POINTS, type DemoBase } from './demo-data';

const HISTORY_DAYS = 30;

/** Frontend bilan bir xil urug' — bir xil tarix. */
export const DEMO_SEED = 20261023;

export type Random = () => number;

/** mulberry32 — kichik, tez, takrorlanuvchi tasodifiy sonlar. */
export function createRandom(seed: number): Random {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(rand: Random, items: [T, number][]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let point = rand() * total;
  for (const [item, weight] of items) {
    point -= weight;
    if (point <= 0) return item;
  }
  return items[items.length - 1][0];
}

/** Qaysi taom ko'proq sotiladi (berilmagani — 2). */
const POPULARITY: Record<string, number> = {
  'burger-cheese': 6,
  'burger-classic': 5,
  'burger-chicken': 4,
  'burger-double': 3,
  'burger-big-ny': 2,
  'hotdog-classic': 4,
  'hotdog-french': 3,
  'lavash-beef': 6,
  'lavash-chicken': 5,
  'lavash-cheese': 3,
  'shawarma-beef': 4,
  'shawarma-chicken': 4,
  fries: 6,
  'nuggets-6': 3,
  cola: 5,
  tea: 3,
};

/** Soat → buyurtmalar zichligi: tushlik va kechki cho'qqilar. */
// prettier-ignore
const HOURS: [number, number][] = [
  [10, 2], [11, 4], [12, 9], [13, 10], [14, 6], [15, 3], [16, 3], [17, 4], [18, 8], [19, 10], [20, 9], [21, 6], [22, 3],
];

/** Mobil ilova mijozlari (demo): ism, telefon, manzil (dostavkada). */
const MOBILE_CUSTOMERS: [name: string, phone: string, address: string][] = [
  ['Aziz', '+998 90 123 45 67', 'Chilonzor 9-kvartal, 12-uy, 34-xonadon'],
  ['Malika', '+998 93 555 12 34', 'Yunusobod 4-mavze, 7-uy, 21-xonadon'],
  ['Javohir', '+998 97 300 70 70', "Mirzo Ulug'bek, Buyuk Ipak yo'li 15"],
  ['Nilufar', '+998 99 888 44 22', 'Sergeli 6-mavze, 3-uy'],
  ['Sardor', '+998 91 222 33 44', "Shayxontohur, Navoiy ko'chasi 40"],
];

/** [date] kunining mahalliy vaqti. */
const at = (date: Date, hours: number, minutes: number, seconds = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds);

const plus = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);

function pickItems(rand: Random, foods: Product[], drinks: Product[]): OrderItem[] {
  const lines = 1 + (rand() < 0.45 ? 1 : 0) + (rand() < 0.15 ? 1 : 0);
  const popularity = (p: Product): [Product, number] => [p, POPULARITY[p.id] ?? 2];
  const chosen: Product[] = [];
  for (let i = 0; i < lines; i++) chosen.push(weighted(rand, foods.map(popularity)));
  if (drinks.length && rand() < 0.55) chosen.push(weighted(rand, drinks.map(popularity)));

  const items: OrderItem[] = [];
  for (const product of chosen) {
    const qty = rand() < 0.15 ? 2 : 1;
    const same = items.find((item) => item.productId === product.id);
    if (same) same.qty += qty;
    else items.push({ productId: product.id, name: product.name, price: product.price, qty });
  }
  return items;
}

export interface DemoHistory {
  orders: Order[];
  shifts: Shift[];
  counters: Counter[];
}

/** O'tgan kunlar: har kuni ikki smena (ertalab / kechqurun), 17–34 ta buyurtma, ~3% bekor qilingan. */
export function seedHistory(base: DemoBase, now: Date, rand: Random): DemoHistory {
  const today = dateKey(now);
  const orders: Order[] = [];
  const shifts: Shift[] = [];
  const counters: Counter[] = [];

  for (const [branchIndex, branch] of base.branches.entries()) {
    const cashiers = base.users.filter((u) => u.role === 'cashier' && u.branchIds.includes(branch.id));
    const sellable = base.products.filter((p) => soldAt(p, branch.id));
    const foods = sellable.filter((p) => p.categoryId !== 'drinks');
    const drinks = sellable.filter((p) => p.categoryId === 'drinks');
    if (foods.length === 0) continue;

    for (let back = HISTORY_DAYS; back >= 1; back--) {
      const day = addDays(today, -back);
      const date = parseDateKey(day);
      const weekend = [0, 5, 6].includes(date.getDay());
      const count = (weekend ? 30 : 22) + Math.floor(rand() * 9) - 4 - branchIndex * 3;

      // smenalar: kassirlar kunma-kun almashib ertalab / kechqurun ishlaydi
      const [morning, evening] =
        back % 2 === 0
          ? [cashiers[0], cashiers[1] ?? cashiers[0]]
          : [cashiers[1] ?? cashiers[0], cashiers[0]];
      const dayShifts: Shift[] = [];
      if (morning && evening) {
        dayShifts.push(
          {
            id: newId('shf'),
            branchId: branch.id,
            cashierId: morning.id,
            openedAt: at(date, 9, 40),
            closedAt: at(date, 16, 5),
          },
          {
            id: newId('shf'),
            branchId: branch.id,
            cashierId: evening.id,
            openedAt: at(date, 15, 55),
            closedAt: at(date, 23, 35),
          },
        );
        shifts.push(...dayShifts);
      }

      // argumentlar chapdan o'ngga hisoblanadi: soat, daqiqa, soniya — frontend bilan bir xil tartib
      const times = Array.from({ length: count }, () =>
        at(date, weighted(rand, HOURS), Math.floor(rand() * 60), Math.floor(rand() * 60)),
      );
      times.sort((a, b) => a.getTime() - b.getTime());

      times.forEach((created, index) => {
        const shift = dayShifts.length ? dayShifts[created.getHours() < 16 ? 0 : 1] : null;
        // ~20% kiosk, ~12% mobil ilova (smena kassiri qabul qilgan), qolgani kassa
        const roll = rand();
        const source: OrderSource = !shift || roll < 0.2 ? 'kiosk' : roll < 0.32 ? 'mobile' : 'cashier';
        const kiosk = source === 'kiosk';
        let type: OrderType =
          source === 'mobile'
            ? weighted<OrderType>(rand, [
                ['delivery', 60],
                ['takeaway', 40],
              ])
            : weighted<OrderType>(rand, [
                ['dine_in', 55],
                ['takeaway', 35],
                ['delivery', 10],
              ]);
        if (kiosk && type === 'delivery') type = 'takeaway';
        const payment: PaymentMethod = kiosk
          ? weighted<PaymentMethod>(rand, [
              ['card', 70],
              ['click', 30],
            ])
          : source === 'mobile'
            ? weighted<PaymentMethod>(rand, [
                ['click', 60],
                ['cash', 40],
              ])
            : weighted<PaymentMethod>(rand, [
                ['cash', 50],
                ['card', 35],
                ['click', 15],
              ]);
        const customer = MOBILE_CUSTOMERS[Math.floor(rand() * MOBILE_CUSTOMERS.length)];
        const online: OnlineInfo | null =
          source === 'mobile'
            ? {
                platform: rand() < 0.55 ? 'android' : 'ios',
                name: customer[0],
                phone: customer[1],
                address: type === 'delivery' ? customer[2] : '',
                payment: payment === 'click' ? 'click' : 'cash',
                // tarixdagi mobil buyurtmalarda joylashuv yo'q (frontendda bu maydon bo'lmagan)
                location: null,
              }
            : null;
        const items = pickItems(rand, foods, drinks);
        const cancelled = rand() < 0.03;
        const ready = plus(created, 300 + Math.floor(rand() * 400));
        // bekor qilinganda bu `rand()` chaqirilmaydi — frontenddagidek
        const preparingAt = cancelled ? null : plus(created, 60 + Math.floor(rand() * 90));

        orders.push({
          id: newId('ord'),
          branchId: branch.id,
          number: index + 1,
          type,
          source,
          items,
          note: '',
          total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
          payment,
          split: null,
          online,
          status: cancelled ? 'cancelled' : 'ready',
          cashierId: kiosk ? null : (shift?.cashierId ?? null),
          shiftId: kiosk ? null : (shift?.id ?? null),
          createdAt: created,
          preparingAt,
          readyAt: cancelled ? null : ready,
          cancelledAt: cancelled ? plus(created, 120) : null,
          cancelledBy: cancelled ? (shift?.cashierId ?? null) : null,
          cancelReason: null,
          routedAt: created,
          transferCount: 0,
          fromBranchId: null,
          trackingTokenHash: null,
          ...NO_COURIER,
          syncedAt: null,
        });
      });
      counters.push({ key: `order:${branch.id}:${day}`, value: count });
    }
  }

  return { orders, shifts, counters };
}

/** Kirimlar (narxi bilan, darhol omborga) va ko'chirishlar — ombor tarixi bo'sh turmasin. */
export async function seedStockDocuments(warehouse: WarehouseService, now: Date): Promise<void> {
  const daysAgo = (days: number, hours: number) => at(new Date(now.getTime() - days * 86_400_000), hours, 0);
  // narx berilmasa — mahsulotning oxirgi narxi
  const lines = (rows: [string, number, number?][]) =>
    rows.map(([ingredientId, qty, price]) => ({ ingredientId, qty, ...(price !== undefined && { price }) }));

  await warehouse.createPurchase(
    {
      warehouseId: WAREHOUSE_CENTRAL,
      items: lines([
        ['chicken-fillet', 40],
        ['potato-fries', 60],
        ['frying-oil', 80],
        ['lavash-bread', 400],
      ]),
      note: 'Haftalik kirim',
    },
    'usr_supplier',
    daysAgo(13, 10),
  );

  await warehouse.createPurchase(
    {
      warehouseId: WAREHOUSE_CENTRAL,
      items: lines([
        ['beef-meat', 50, 128000],
        ['tomato', 60, 13000],
        ['cucumber', 50],
        ['cup-paper', 1000],
      ]),
      note: '',
    },
    'usr_supplier',
    daysAgo(6, 9),
  );

  await warehouse.createTransfer(
    {
      fromWarehouseId: WAREHOUSE_CENTRAL,
      toWarehouseId: 'wh_chilonzor',
      items: lines([
        ['chicken-fillet', 10],
        ['potato-fries', 15],
        ['lavash-bread', 80],
      ]),
    },
    'usr_supplier',
    daysAgo(12, 9),
  );
  await warehouse.createTransfer(
    {
      fromWarehouseId: WAREHOUSE_CENTRAL,
      toWarehouseId: 'wh_yunusobod',
      items: lines([
        ['beef-meat', 10],
        ['tomato', 12],
        ['cup-paper', 200],
      ]),
    },
    'usr_supplier',
    daysAgo(5, 9),
  );
  await warehouse.createTransfer(
    {
      fromWarehouseId: 'wh_chilonzor',
      toWarehouseId: 'wh_yunusobod',
      items: lines([['sausage', 30]]),
      note: 'Yunusobodda sosiska tugab qoldi',
    },
    'usr_supplier',
    daysAgo(2, 18),
  );

  // bugungi kirim — narxlar oxirgi narxdan
  await warehouse.createPurchase(
    {
      warehouseId: WAREHOUSE_CENTRAL,
      items: lines([
        ['beef-mince', 25],
        ['tomato', 40],
        ['kimchi', 10],
        ['bun-burger', 300],
      ]),
    },
    'usr_supplier',
    new Date(now.getTime() - 40 * 60_000),
  );
}

interface LiveOrder {
  /** necha daqiqa oldin */
  ago: number;
  items: [productId: string, qty: number][];
  type: OrderType;
  source: OrderSource;
  /** `null` — kioskdan, kassada hali to'lanmagan; mobil ilovadan — hali qabul qilinmagan */
  payment: PaymentMethod | null;
  note?: string;
  /** faqat mobil ilovada: mijoz ma'lumotlari (joylashuvi — dostavkada filial hududidagi nuqta) */
  online?: Omit<OnlineInfo, 'location'>;
  /** mobil buyurtmani kassir necha daqiqa oldin qabul qilgan (yo'q bo'lsa — hali qabul kutilmoqda) */
  accepted?: number;
  /** necha daqiqa oldin tayyor bo'lgan (yo'q bo'lsa — hali tayyorlanmoqda) */
  ready?: number;
}

// prettier-ignore
const LIVE: Record<string, LiveOrder[]> = {
  br_chilonzor: [
    { ago: 52, items: [['burger-cheese', 1], ['fries', 1], ['cola', 1]], type: 'dine_in', source: 'cashier', payment: 'cash', ready: 40 },
    {
      ago: 25,
      items: [['lavash-beef', 2], ['cola', 2]],
      type: 'delivery',
      source: 'mobile',
      payment: null,
      online: { platform: 'android', name: 'Malika', phone: '+998 93 555 12 34', address: 'Yunusobod 4-mavze, 7-uy, 21-xonadon', payment: 'cash' },
      accepted: 23,
    },
    { ago: 44, items: [['lavash-beef', 2], ['fanta', 2]], type: 'takeaway', source: 'kiosk', payment: 'card', ready: 33 },
    { ago: 14, items: [['shawarma-chicken', 1], ['tea', 1]], type: 'dine_in', source: 'cashier', payment: 'click', ready: 3 },
    { ago: 12, items: [['burger-double', 1], ['potato-wedges', 1], ['sprite', 1]], type: 'takeaway', source: 'cashier', payment: 'card', note: 'Burger piyozsiz', ready: 1 },
    { ago: 10, items: [['hotdog-kimchi', 2], ['cola', 2]], type: 'dine_in', source: 'kiosk', payment: 'click' },
    { ago: 8, items: [['lavash-spicy', 1], ['nuggets-6', 1]], type: 'delivery', source: 'cashier', payment: 'cash', note: "Lavash achchiq kamroq, ketchupni alohida qo'ying" },
    { ago: 6, items: [['burger-big-ny', 1], ['fries', 2], ['cola', 2]], type: 'dine_in', source: 'cashier', payment: 'card' },
    { ago: 3, items: [['shawarma-xl', 1], ['water', 1]], type: 'takeaway', source: 'kiosk', payment: null },
    { ago: 2, items: [['hotdog-classic', 3]], type: 'dine_in', source: 'cashier', payment: 'cash', note: 'Hot-doglar gorchitsasiz' },
    { ago: 1, items: [['burger-chicken', 1], ['onion-rings', 1], ['tea', 1]], type: 'dine_in', source: 'kiosk', payment: null },
    {
      ago: 1,
      items: [['burger-big-ny', 1], ['fries', 1], ['cola', 1]],
      type: 'delivery',
      source: 'mobile',
      payment: null,
      online: { platform: 'ios', name: 'Aziz', phone: '+998 90 123 45 67', address: 'Chilonzor 9-kvartal, 12-uy, 34-xonadon', payment: 'click' },
      note: "Eshik oldida qo'ng'iroq qiling",
    },
  ],
  br_yunusobod: [
    { ago: 38, items: [['burger-classic', 1], ['cola', 1]], type: 'dine_in', source: 'cashier', payment: 'cash', ready: 30 },
    { ago: 9, items: [['lavash-chicken', 1], ['fries', 1]], type: 'takeaway', source: 'kiosk', payment: 'card', ready: 2 },
    { ago: 7, items: [['shawarma-beef', 2]], type: 'dine_in', source: 'cashier', payment: 'click', note: 'Shaurmalar piyozsiz' },
    { ago: 2, items: [['burger-chicken', 1], ['tea', 2]], type: 'takeaway', source: 'kiosk', payment: null },
  ],
};

const actorOf = (user: DemoBase['users'][number]): AuthUser => ({
  id: user.id,
  name: user.name,
  surname: user.surname,
  role: user.role,
  branchId: user.branchIds[0] ?? null,
  branchIds: user.branchIds,
  email: user.email,
});

/** Bugungi buyurtmalar haqiqiy mantiq orqali (ombordan ayriladi, raqamlar navbatda). Kassirlarning smenasi ochiq. */
export async function seedToday(
  services: { orders: OrdersService; shifts: ShiftsService },
  base: DemoBase,
  now: Date,
): Promise<void> {
  const dayStart = at(now, 0, 0).getTime();
  const minutesAgo = (minutes: number) =>
    new Date(Math.max(dayStart + 60_000, now.getTime() - minutes * 60_000));

  for (const [branchId, specs] of Object.entries(LIVE)) {
    const cashier = base.users.find((u) => u.role === 'cashier' && u.branchIds.includes(branchId));
    const kitchen = base.users.find((u) => u.role === 'kitchen' && u.branchIds.includes(branchId));
    if (!cashier || !kitchen) continue;
    await services.shifts.openOrResume(cashier.id, branchId, minutesAgo(180));

    for (const spec of specs) {
      const order = await services.orders.place(
        {
          branchId,
          type: spec.type,
          source: spec.source,
          items: spec.items.map(([productId, qty]) => ({ productId, qty })),
          note: spec.note,
          payment: spec.payment,
          cashierId: spec.source === 'cashier' ? cashier.id : null,
          online: spec.online
            ? { ...spec.online, location: spec.type === 'delivery' ? ZONE_POINTS[branchId] : null }
            : null,
        },
        minutesAgo(spec.ago),
      );
      if (spec.online && spec.accepted !== undefined) {
        await services.orders.confirm(order.id, actorOf(cashier), {}, minutesAgo(spec.accepted));
      }
      if (spec.ready !== undefined) {
        await services.orders.markReady(order.id, actorOf(kitchen), minutesAgo(spec.ready));
      }
    }
  }
}

/** Kommunal to'lovlar: tur, oyning qaysi kuni, filial uchun asosiy summa, izoh. */
const BILLS: [kind: ExpenseKind, day: number, amount: number, note: string][] = [
  ['internet', 3, 350_000, ''],
  ['electricity', 5, 2_800_000, ''],
  ['gas', 7, 1_300_000, ''],
  ['water', 10, 380_000, ''],
  ['other', 15, 150_000, 'Chiqindi olib ketish'],
];

/** Oxirgi 3 oyning kommunal to'lovlari (bugungacha). */
export async function seedExpenses(
  expenses: ExpensesService,
  base: DemoBase,
  now: Date,
  rand: Random,
): Promise<void> {
  const today = dateKey(now);
  for (let monthsBack = 2; monthsBack >= 0; monthsBack--) {
    for (const [branchIndex, branch] of base.branches.entries()) {
      for (const [kind, day, amountBase, note] of BILLS) {
        const date = new Date(now.getFullYear(), now.getMonth() - monthsBack, day);
        const key = dateKey(date);
        if (key >= today) continue;
        const amount =
          Math.round((amountBase * (1 - branchIndex * 0.12) * (0.9 + rand() * 0.2)) / 1000) * 1000;
        await expenses.create(
          { branchId: branch.id, kind, amount, date: key, note },
          'usr_admin',
          at(date, 11, 0),
        );
      }
    }
  }
}
