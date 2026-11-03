import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import { hashPin } from '../src/auth/pin';
import { Branch } from '../src/branches/branch.entity';
import { Warehouse } from '../src/branches/warehouse.entity';
import {
  EXPENSE_KINDS,
  ORDER_TYPES,
  PAYMENT_METHODS,
  type ExpenseKind,
  type OrderSource,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
} from '../src/common/enums';
import type { LocalizedText, OrderItem, PaymentSplit } from '../src/common/types';
import { dateKey, dateRange } from '../src/domain/dates';
import { Expense } from '../src/expenses/expense.entity';
import { NO_COURIER, Order } from '../src/orders/order.entity';
import {
  ReportsService,
  type ProductStat,
  type ReportRange,
  type SalesReport,
  type Tally,
} from '../src/reports/reports.service';
import { User } from '../src/users/user.entity';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { Purchase } from '../src/warehouse/purchase.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { createTestApp, expectCode, truncateAll } from './test-app';

// ── frontend `src/domain/logic/reports.ts` → `salesReport` ning to'g'ridan-to'g'ri porti (xotirada) ──

interface MemoryDb {
  branches: Branch[];
  orders: Order[];
  expenses: Expense[];
}

const tally = (): Tally => ({ orders: 0, revenue: 0 });

function orderPayments(order: Order): Record<PaymentMethod, number> {
  const result: Record<PaymentMethod, number> = { cash: 0, card: 0, click: 0 };
  if (order.split) for (const method of PAYMENT_METHODS) result[method] = order.split[method] ?? 0;
  else if (order.payment) result[order.payment] = order.total;
  return result;
}

function salesReportPort(db: MemoryDb, range: ReportRange): SalesReport {
  const days = dateRange(range.from, range.to);
  const dayIndex = new Map(days.map((date, index) => [date, index]));
  const inBranch = (branchId: string) => range.branchId === null || branchId === range.branchId;

  const report: SalesReport = {
    ...tally(),
    cancelled: 0,
    cancelledAmount: 0,
    avgCheck: 0,
    byPayment: Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>,
    byType: Object.fromEntries(ORDER_TYPES.map((type) => [type, tally()])) as Record<OrderType, Tally>,
    bySource: { cashier: tally(), kiosk: tally(), mobile: tally() },
    byHour: Array.from({ length: 24 }, () => 0),
    days: days.map((date) => ({ date, ...tally(), expenses: 0 })),
    topProducts: [],
    byBranch: db.branches
      .filter((b) => inBranch(b.id))
      .map((b) => ({ branchId: b.id, ...tally(), expenses: 0 })),
    expenses: 0,
    expensesByKind: Object.fromEntries(EXPENSE_KINDS.map((k) => [k, 0])) as Record<ExpenseKind, number>,
    net: 0,
  };
  const products = new Map<string, ProductStat>();
  const branchStat = (branchId: string) => report.byBranch.find((b) => b.branchId === branchId);

  for (const order of db.orders) {
    if (!inBranch(order.branchId)) continue;
    const created = new Date(order.createdAt);
    const index = dayIndex.get(dateKey(created));
    if (index === undefined) continue;
    if (order.status === 'pending') continue;
    if (order.status === 'cancelled') {
      report.cancelled += 1;
      report.cancelledAmount += order.total;
      continue;
    }
    report.orders += 1;
    report.revenue += order.total;
    const parts = orderPayments(order);
    for (const method of PAYMENT_METHODS) report.byPayment[method] += parts[method];
    report.byType[order.type].orders += 1;
    report.byType[order.type].revenue += order.total;
    report.bySource[order.source].orders += 1;
    report.bySource[order.source].revenue += order.total;
    report.byHour[created.getHours()] += order.total;
    report.days[index].orders += 1;
    report.days[index].revenue += order.total;
    const branch = branchStat(order.branchId);
    if (branch) {
      branch.orders += 1;
      branch.revenue += order.total;
    }
    for (const item of order.items) {
      const stat = products.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        qty: 0,
        revenue: 0,
      };
      stat.qty += item.qty;
      stat.revenue += item.price * item.qty;
      products.set(item.productId, stat);
    }
  }

  for (const expense of db.expenses) {
    if (!inBranch(expense.branchId)) continue;
    const index = dayIndex.get(expense.date);
    if (index === undefined) continue;
    report.expenses += expense.amount;
    report.expensesByKind[expense.kind] += expense.amount;
    report.days[index].expenses += expense.amount;
    const branch = branchStat(expense.branchId);
    if (branch) branch.expenses += expense.amount;
  }

  report.avgCheck = report.orders > 0 ? Math.round(report.revenue / report.orders) : 0;
  report.net = report.revenue - report.expenses;
  report.topProducts = [...products.values()].sort((a, b) => b.revenue - a.revenue);
  return report;
}

// ── fixture'lar (demo seed'siz) ──

// id'lar alifbo tartibida emas — filiallar tartibi `createdAt` bo'yicha ekanini tekshirish uchun
const A = 'br_yunusobod';
const B = 'br_chilonzor';
const C = 'br_closed';

const text = (value: string): LocalizedText => ({ uz: value, ru: `${value} ru`, en: `${value} en` });
const item = (productId: string, name: string, price: number, qty: number): OrderItem => ({
  productId,
  name: text(name),
  price,
  qty,
});

let orderNumber = 0;
function order(input: {
  id: string;
  branchId: string;
  createdAt: string;
  status: OrderStatus;
  type: OrderType;
  source: OrderSource;
  items: OrderItem[];
  payment?: PaymentMethod | null;
  split?: PaymentSplit;
}): Order {
  const createdAt = new Date(input.createdAt);
  return {
    id: input.id,
    branchId: input.branchId,
    number: ++orderNumber,
    type: input.type,
    source: input.source,
    items: input.items,
    note: '',
    total: input.items.reduce((sum, line) => sum + line.price * line.qty, 0),
    payment: input.payment ?? null,
    split: input.split ?? null,
    online: null,
    status: input.status,
    cashierId: null,
    shiftId: null,
    createdAt,
    preparingAt: input.status === 'pending' ? null : createdAt,
    readyAt: null,
    cancelledAt: input.status === 'cancelled' ? createdAt : null,
    cancelledBy: null,
    cancelReason: null,
    routedAt: createdAt,
    transferCount: 0,
    fromBranchId: null,
    trackingTokenHash: null,
    ...NO_COURIER,
    syncedAt: null,
  };
}

const ORDERS: Order[] = [
  // 21-oktabr, 10:10 mahalliy
  order({
    id: 'ord_01',
    branchId: A,
    createdAt: '2026-10-21T05:10:00Z',
    status: 'preparing',
    type: 'dine_in',
    source: 'cashier',
    payment: 'cash',
    items: [item('p_burger', 'Burger', 30000, 2), item('p_cola', 'Cola', 10000, 1)],
  }),
  // 21-oktabr, 14:45 — burgerning nomi o'zgargan (hisobotda birinchi uchragan nomi qoladi)
  order({
    id: 'ord_02',
    branchId: A,
    createdAt: '2026-10-21T09:45:00Z',
    status: 'ready',
    type: 'takeaway',
    source: 'kiosk',
    payment: 'card',
    // id alifboda cola'dan oldin, lekin keyin uchragan — tushumi teng (30000) bo'lsa ham cola'dan keyin turadi
    items: [item('p_burger', 'Burger XL', 32000, 1), item('p_a_icecream', 'Muzqaymoq', 15000, 2)],
  }),
  // 22-oktabr 19:30Z = 23-oktabr 00:30 mahalliy → kun 23, soat 0
  order({
    id: 'ord_03',
    branchId: B,
    createdAt: '2026-10-22T19:30:00Z',
    status: 'ready',
    type: 'delivery',
    source: 'mobile',
    payment: 'click',
    items: [item('p_fries', 'Fri', 15000, 3)],
  }),
  // 22-oktabr, 12:00 — aralash to'lov
  order({
    id: 'ord_04',
    branchId: B,
    createdAt: '2026-10-22T07:00:00Z',
    status: 'preparing',
    type: 'dine_in',
    source: 'cashier',
    payment: 'card',
    split: { cash: 20000, card: 30000 },
    items: [
      item('p_burger', 'Burger XL', 32000, 1),
      item('p_cola', 'Cola', 10000, 1),
      item('p_fries', 'Fri', 8000, 1),
    ],
  }),
  // kassada to'lanmagan kiosk buyurtmasi — hisobotga umuman kirmaydi
  order({
    id: 'ord_05',
    branchId: A,
    createdAt: '2026-10-22T10:00:00Z',
    status: 'pending',
    type: 'takeaway',
    source: 'kiosk',
    items: [item('p_pending_only', 'Kutilmoqda', 50000, 5)],
  }),
  // bekor qilingan — faqat soni va summasi
  order({
    id: 'ord_06',
    branchId: A,
    createdAt: '2026-10-23T06:00:00Z',
    status: 'cancelled',
    type: 'dine_in',
    source: 'cashier',
    payment: 'cash',
    items: [item('p_salad', 'Salat', 30000, 1)],
  }),
  // 20-oktabr 23:59 mahalliy — oraliqdan tashqarida
  order({
    id: 'ord_07',
    branchId: B,
    createdAt: '2026-10-20T18:59:00Z',
    status: 'ready',
    type: 'dine_in',
    source: 'cashier',
    payment: 'cash',
    items: [item('p_burger', 'Eski burger', 1000, 1)],
  }),
  // 23-oktabr 23:59:59 mahalliy — oxirgi soniya, kiradi; aralash to'lov (karta + click)
  order({
    id: 'ord_08',
    branchId: A,
    createdAt: '2026-10-23T18:59:59Z',
    status: 'ready',
    type: 'takeaway',
    source: 'mobile',
    payment: 'card',
    split: { card: 5000, click: 5000 },
    items: [item('p_cola', 'Cola', 10000, 1)],
  }),
  // 24-oktabr 00:00 mahalliy — oraliqdan tashqarida
  order({
    id: 'ord_09',
    branchId: B,
    createdAt: '2026-10-23T19:00:00Z',
    status: 'ready',
    type: 'delivery',
    source: 'mobile',
    payment: 'click',
    items: [item('p_fries', 'Fri', 15000, 1)],
  }),
  // oraliqdan tashqaridagi bekor qilingan
  order({
    id: 'ord_10',
    branchId: A,
    createdAt: '2026-10-24T03:00:00Z',
    status: 'cancelled',
    type: 'dine_in',
    source: 'cashier',
    payment: 'cash',
    items: [item('p_burger', 'Burger', 99000, 1)],
  }),
];

const expense = (id: string, branchId: string, kind: ExpenseKind, amount: number, date: string): Expense => ({
  id,
  branchId,
  kind,
  amount,
  date,
  note: '',
  createdBy: 'usr_admin',
  createdAt: new Date('2026-10-25T08:00:00Z'),
});

const EXPENSES: Expense[] = [
  expense('exp_1', A, 'electricity', 100000, '2026-10-21'), // oraliq boshi
  expense('exp_2', B, 'gas', 50000, '2026-10-23'), // oraliq oxiri
  expense('exp_3', A, 'water', 20000, '2026-10-20'), // tashqarida
  expense('exp_4', B, 'internet', 30000, '2026-10-24'), // tashqarida
  expense('exp_5', A, 'electricity', 5000, '2026-10-23'),
  expense('exp_6', C, 'other', 7000, '2026-10-22'), // faol bo'lmagan filial ham hisobotda
];

async function insertFixtures(em: EntityManager): Promise<void> {
  await em.insert(Branch, [
    { id: A, name: 'Yunusobod', active: true, createdAt: new Date('2026-01-01T00:00:00Z') },
    { id: B, name: 'Chilonzor', active: true, createdAt: new Date('2026-02-01T00:00:00Z') },
    { id: C, name: 'Yopilgan', active: false, createdAt: new Date('2026-03-01T00:00:00Z') },
  ]);
  await em.insert(User, [
    {
      id: 'usr_admin',
      name: 'Admin',
      role: 'admin',
      branchId: null,
      email: 'admin@gmail.com',
      pinHash: await hashPin('admin-1111'),
      active: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'usr_cashier',
      name: 'Kassir',
      role: 'cashier',
      branchId: A,
      pinHash: await hashPin('2222'),
      active: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ]);
  await em.insert(Order, ORDERS);
  await em.insert(Expense, EXPENSES);

  // ombor: 1 ta kam qolgan (5 < 10), 1 ta aynan chegarada (kam emas), 1 ta kuzatilmaydigan (minQty 0, manfiy qoldiq)
  await em.insert(Warehouse, [
    { id: 'wh_central', name: 'Markaziy', kind: 'central', branchId: null },
    { id: 'wh_a', name: 'Yunusobod', kind: 'branch', branchId: A },
  ]);
  await em.insert(
    Ingredient,
    ['ing_1', 'ing_2', 'ing_3'].map((id) => ({
      id,
      name: text(id),
      group: 'meat' as const,
      unit: 'kg' as const,
    })),
  );
  await em.insert(StockItem, [
    { warehouseId: 'wh_a', ingredientId: 'ing_1', qty: 5, minQty: 10 },
    { warehouseId: 'wh_a', ingredientId: 'ing_2', qty: 10, minQty: 10 },
    { warehouseId: 'wh_central', ingredientId: 'ing_3', qty: -3, minQty: 0 },
  ]);
  const purchase = (id: string, number: number, status: Purchase['status']) => ({
    id,
    number,
    warehouseId: 'wh_central',
    items: [],
    status,
    createdBy: 'usr_admin',
    createdAt: new Date('2026-10-25T08:00:00Z'),
  });
  await em.insert(Purchase, [
    purchase('pur_1', 1, 'pending'),
    purchase('pur_2', 2, 'pending'),
    purchase('pur_3', 3, 'approved'),
  ]);
}

describe('hisobotlar (SQL ↔ frontend salesReport)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let reports: ReportsService;
  let memory: MemoryDb;

  const expected = (range: ReportRange) => salesReportPort(memory, range);

  beforeAll(async () => {
    app = await createTestApp();
    await truncateAll(app);
    em = app.get(DataSource).manager;
    reports = app.get(ReportsService);
    await insertFixtures(em);
    // port bazadan qayta o'qilgan qatorlar ustida ishlaydi (frontend `db.orders` — qo'shilish tartibida)
    memory = {
      branches: await em.find(Branch, { order: { createdAt: 'ASC', name: 'ASC' } }),
      orders: await em.find(Order, { order: { createdAt: 'ASC', id: 'ASC' } }),
      expenses: await em.find(Expense, { order: { createdAt: 'ASC', id: 'ASC' } }),
    };
  });

  afterAll(() => app.close());

  it.each<[string, ReportRange]>([
    ['barcha filiallar, 3 kun', { from: '2026-10-21', to: '2026-10-23', branchId: null }],
    ['bitta filial', { from: '2026-10-21', to: '2026-10-23', branchId: B }],
    [
      'bitta kun (yarim tundan keyingi buyurtma bilan)',
      { from: '2026-10-23', to: '2026-10-23', branchId: null },
    ],
    ['kengroq oraliq (tashqaridagilar ham)', { from: '2026-10-19', to: '2026-10-25', branchId: null }],
    ["faol bo'lmagan filial", { from: '2026-10-01', to: '2026-10-31', branchId: C }],
    ["noma'lum filial", { from: '2026-10-21', to: '2026-10-23', branchId: 'br_missing' }],
    ['from > to', { from: '2026-10-23', to: '2026-10-21', branchId: null }],
    ['400 kunlik chegara', { from: '2025-09-19', to: '2027-01-01', branchId: null }],
  ])('%s — frontend bilan bir xil', async (_name, range) => {
    const actual = await reports.sales(range);
    expect(actual).toStrictEqual(expected(range));
  });

  it('aniq qiymatlar (barcha filiallar, 21–23 oktabr)', async () => {
    const report = await reports.sales({ from: '2026-10-21', to: '2026-10-23', branchId: null });
    expect(report.orders).toBe(5);
    expect(report.revenue).toBe(237000);
    expect(report.cancelled).toBe(1);
    expect(report.cancelledAmount).toBe(30000);
    expect(report.avgCheck).toBe(47400);
    expect(report.byPayment).toEqual({ cash: 90000, card: 97000, click: 50000 });
    expect(report.byType).toEqual({
      dine_in: { orders: 2, revenue: 120000 },
      takeaway: { orders: 2, revenue: 72000 },
      delivery: { orders: 1, revenue: 45000 },
    });
    expect(report.bySource).toEqual({
      cashier: { orders: 2, revenue: 120000 },
      kiosk: { orders: 1, revenue: 62000 },
      mobile: { orders: 2, revenue: 55000 },
    });
    // 00:30 mahalliy (19:30Z) buyurtma — 0-soat va 23-kun
    expect(report.byHour[0]).toBe(45000);
    expect(report.byHour[10]).toBe(70000);
    expect(report.byHour[12]).toBe(50000);
    expect(report.byHour[14]).toBe(62000);
    expect(report.byHour[23]).toBe(10000);
    expect(report.byHour.reduce((sum, value) => sum + value, 0)).toBe(237000);
    expect(report.days).toEqual([
      { date: '2026-10-21', orders: 2, revenue: 132000, expenses: 100000 },
      { date: '2026-10-22', orders: 1, revenue: 50000, expenses: 7000 },
      { date: '2026-10-23', orders: 2, revenue: 55000, expenses: 55000 },
    ]);
    expect(report.topProducts).toEqual([
      { productId: 'p_burger', name: text('Burger'), qty: 4, revenue: 124000 },
      { productId: 'p_fries', name: text('Fri'), qty: 4, revenue: 53000 },
      { productId: 'p_cola', name: text('Cola'), qty: 3, revenue: 30000 },
      { productId: 'p_a_icecream', name: text('Muzqaymoq'), qty: 2, revenue: 30000 },
    ]);
    expect(report.byBranch).toEqual([
      { branchId: A, orders: 3, revenue: 142000, expenses: 105000 },
      { branchId: B, orders: 2, revenue: 95000, expenses: 50000 },
      { branchId: C, orders: 0, revenue: 0, expenses: 7000 },
    ]);
    expect(report.expenses).toBe(162000);
    expect(report.expensesByKind).toEqual({
      electricity: 105000,
      gas: 50000,
      water: 0,
      internet: 0,
      other: 7000,
    });
    expect(report.net).toBe(75000);
  });

  it("filial bo'yicha: faqat o'sha filial qatori", async () => {
    const report = await reports.sales({ from: '2026-10-21', to: '2026-10-23', branchId: B });
    expect(report.orders).toBe(2);
    expect(report.revenue).toBe(95000);
    expect(report.byBranch).toEqual([{ branchId: B, orders: 2, revenue: 95000, expenses: 50000 }]);
    expect(report.byPayment).toEqual({ cash: 20000, card: 30000, click: 45000 });
  });

  it("from > to — bo'sh kunlar, xato emas", async () => {
    const report = await reports.sales({ from: '2026-10-23', to: '2026-10-21', branchId: null });
    expect(report.days).toEqual([]);
    expect(report.orders).toBe(0);
    expect(report.expenses).toBe(0);
    expect(report.byBranch.map((b) => b.branchId)).toEqual([A, B, C]);
  });

  it('400 kunlik chegaradan keyingi kunlar kirmaydi', async () => {
    const report = await reports.sales({ from: '2025-09-19', to: '2027-01-01', branchId: null });
    expect(report.days).toHaveLength(400);
    expect(report.days[399].date).toBe('2026-10-23');
    // 24-oktabrdagi buyurtma va xarajat chegaradan tashqarida
    expect(report.revenue).toBe(237000 + 1000);
    expect(report.expenses).toBe(162000 + 20000);
  });

  it("haqiqiy bo'lmagan sana — invalid_input", async () => {
    await expectCode('invalid_input', () =>
      reports.sales({ from: '2026-02-30', to: '2026-03-01', branchId: null }),
    );
  });

  it('overview: faol filiallardagi jonli buyurtmalar, kam qolgan mahsulotlar, kutilayotgan kirimlar', async () => {
    expect(await reports.overview()).toStrictEqual({
      liveOrders: [
        { branchId: A, count: 2 },
        { branchId: B, count: 1 },
      ],
      lowStock: 1,
      pendingPurchases: 2,
      // eng oldingi buyurtma 2026-10-20T18:59Z — Toshkentda 20-oktabr 23:59
      firstOrderDate: '2026-10-20',
    });
  });

  describe('HTTP', () => {
    const login = async (): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'admin@gmail.com', password: 'admin-1111' })
        .expect(200);
      return res.body.token as string;
    };

    it('admin: hisobot va overview', async () => {
      const token = await login();
      const sales = await request(app.getHttpServer())
        .get('/api/reports/sales')
        .query({ from: '2026-10-21', to: '2026-10-23' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(sales.body).toEqual(expected({ from: '2026-10-21', to: '2026-10-23', branchId: null }));

      const filtered = await request(app.getHttpServer())
        .get('/api/reports/sales')
        .query({ from: '2026-10-21', to: '2026-10-23', branchId: A })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(filtered.body).toEqual(expected({ from: '2026-10-21', to: '2026-10-23', branchId: A }));

      const overview = await request(app.getHttpServer())
        .get('/api/reports/overview')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(overview.body).toEqual({
        liveOrders: [
          { branchId: A, count: 2 },
          { branchId: B, count: 1 },
        ],
        lowStock: 1,
        pendingPurchases: 2,
        firstOrderDate: '2026-10-20',
      });
    });

    it("admin: noto'g'ri so'rov — 400 invalid_input", async () => {
      const token = await login();
      for (const query of [
        { from: '2026-10-21' },
        { from: '21.10.2026', to: '2026-10-23' },
        { from: '2026-02-30', to: '2026-03-01' },
      ]) {
        const res = await request(app.getHttpServer())
          .get('/api/reports/sales')
          .query(query)
          .set('Authorization', `Bearer ${token}`)
          .expect(400);
        expect(res.body.code).toBe('invalid_input');
      }
    });

    it("admin bo'lmagan xodim — 403, tokensiz — 401", async () => {
      const session = await request(app.getHttpServer()).post('/api/auth/login').send({ userId: 'usr_cashier', pin: '2222' }).expect(200);
      const token = session.body.token as string;
      for (const path of ['/api/reports/sales?from=2026-10-21&to=2026-10-23', '/api/reports/overview']) {
        const res = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        expect(res.body.code).toBe('forbidden');
        await request(app.getHttpServer()).get(path).expect(401);
      }
    });
  });
});
