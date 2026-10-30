import { HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type, type FunctionDeclaration, type Schema } from '@google/genai';
import { DataSource, In, IsNull } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { BranchesService } from '../branches/branches.service';
import { Warehouse } from '../branches/warehouse.entity';
import {
  EXPENSE_KINDS,
  ORDER_SOURCES,
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  PURCHASE_STATUSES,
  type ExpenseKind,
  type StockUnit,
} from '../common/enums';
import { addDays, dateKey, isRealDateKey, parseDateKey, type DateKey } from '../domain/dates';
import { fromBase } from '../domain/units';
import { ExpensesService } from '../expenses/expenses.service';
import { Category } from '../menu/category.entity';
import { Product } from '../menu/product.entity';
import { OrdersService } from '../orders/orders.service';
import { ReportsService, type DayPoint } from '../reports/reports.service';
import { Shift } from '../shifts/shift.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { User } from '../users/user.entity';
import { Ingredient } from '../warehouse/ingredient.entity';
import { Purchase } from '../warehouse/purchase.entity';
import { StockItem } from '../warehouse/stock-item.entity';
import { clock } from './ai.prompt';

type Args = Record<string, unknown>;

/** Modelga qaytadigan javob: `output` — natija, `error` — xato (Gemini shu kalitlarni kutadi). */
export type ToolResponse = { output: unknown } | { error: string };

interface Tool {
  declaration: FunctionDeclaration;
  run: (args: Args) => Promise<unknown>;
}

/** Model noto'g'ri argument berdi — xato matni modelga qaytadi, u tuzatib qayta chaqiradi. */
class ToolArgError extends Error {}

// ───────────────────────── argumentlar ─────────────────────────

const text = (args: Args, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

function dateArg(args: Args, key: string): DateKey {
  const value = text(args, key);
  if (!value || !isRealDateKey(value)) throw new ToolArgError(`${key}: a real date in YYYY-MM-DD format is required`);
  return value;
}

function periodArgs(args: Args): { from: DateKey; to: DateKey } {
  const from = dateArg(args, 'from');
  const to = dateArg(args, 'to');
  if (from > to) throw new ToolArgError('from must not be after to');
  return { from, to };
}

function oneOf<T extends string>(args: Args, key: string, values: readonly T[]): T | undefined {
  const value = text(args, key);
  if (value === undefined) return undefined;
  if (!(values as readonly string[]).includes(value)) throw new ToolArgError(`${key}: one of ${values.join(', ')}`);
  return value as T;
}

/** Sana oralig'i → ISO: `from` kunining boshidan `to` dan keyingi kun boshigacha (kirmaydi). */
const isoRange = ({ from, to }: { from: DateKey; to: DateKey }) => ({
  from: parseDateKey(from).toISOString(),
  to: parseDateKey(addDays(to, 1)).toISOString(),
});

/** Mahalliy vaqt: `2026-10-29 14:05`. */
const localTime = (date: Date | null): string | null => (date ? `${dateKey(date)} ${clock(date)}` : null);

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Birlik javobda shu ko'rinishda — model "pcs" ni o'zbekcha javobga ham ko'chirib qo'ymasin (ruschada "шт" ga o'giradi). */
const UNIT_LABEL: Record<StockUnit, string> = { kg: 'kg', l: 'l', pcs: 'dona' };
const unitLabel = (unit: StockUnit | undefined) => (unit ? UNIT_LABEL[unit] : undefined);

// ───────────────────────── sxema bo'laklari ─────────────────────────

const PERIOD: Record<string, Schema> = {
  from: { type: Type.STRING, description: 'First day of the period, YYYY-MM-DD (inclusive)' },
  to: { type: Type.STRING, description: 'Last day of the period, YYYY-MM-DD (inclusive)' },
};
const BRANCH: Schema = { type: Type.STRING, description: 'Branch id from the list. Omit for all branches' };
const choice = (values: readonly string[], description: string): Schema => ({
  type: Type.STRING,
  enum: [...values],
  description,
});

/**
 * Ombor nomi web ilovadagidek (`src/lib/warehouses.ts` → `warehouseLabel`): filial ombori — filialning **hozirgi** nomi
 * bilan. Bazadagi `warehouses.name` filial qayta nomlanganda o'zgarmaydi (eski "Chilonzor ombori" qolib ketadi).
 */
function warehouseLabel(warehouse: Warehouse, branchNames: Map<string, string>): string {
  if (warehouse.kind === 'central') return 'Markaziy ombor';
  const branch = warehouse.branchId ? branchNames.get(warehouse.branchId) : undefined;
  return branch ? `${branch} ombori` : warehouse.name;
}

/** Davr uzun bo'lsa (3 oydan ortiq) kunlik ro'yxat o'rniga oylik — javob ixcham qolsin. */
const DAYS_LIMIT = 92;

function byMonth(days: DayPoint[]) {
  const months = new Map<string, { month: string; orders: number; revenue: number; expenses: number }>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const month = months.get(key) ?? { month: key, orders: 0, revenue: 0, expenses: 0 };
    month.orders += day.orders;
    month.revenue += day.revenue;
    month.expenses += day.expenses;
    months.set(key, month);
  }
  return [...months.values()];
}

/**
 * AI tool'lari — **faqat o'qish**, mavjud servislar ustidan. Natijada nomlar (filial, kassir, mahsulot) id o'rniga;
 * mijoz ismi, telefoni va manzili yo'q.
 */
@Injectable()
export class AiTools {
  private readonly logger = new Logger('AiTools');
  private readonly tools: Map<string, Tool>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reports: ReportsService,
    private readonly shifts: ShiftsService,
    private readonly expenses: ExpensesService,
    private readonly orders: OrdersService,
    private readonly branches: BranchesService,
  ) {
    const tools: Tool[] = [
      this.salesReport(),
      this.currentStatus(),
      this.shiftList(),
      this.expenseList(),
      this.purchaseList(),
      this.stock(),
      this.orderList(),
      this.menu(),
    ];
    this.tools = new Map(tools.map((tool) => [tool.declaration.name!, tool]));
  }

  get declarations(): FunctionDeclaration[] {
    return [...this.tools.values()].map((tool) => tool.declaration);
  }

  /** System prompt uchun: filiallar va omborlar ro'yxati. */
  async directory() {
    const em = this.dataSource.manager;
    const [branches, warehouses] = await Promise.all([
      em.find(Branch, { order: { createdAt: 'ASC', name: 'ASC' } }),
      em.find(Warehouse, { order: { kind: 'DESC', name: 'ASC' } }),
    ]);
    const branchNames = new Map(branches.map((b) => [b.id, b.name]));
    return {
      branches: branches.map((b) => ({ id: b.id, name: b.name, active: b.active })),
      warehouses: warehouses.map((w) => ({ id: w.id, name: warehouseLabel(w, branchNames) })),
    };
  }

  /** Ovozni matnga o'girish uchun nomlar: filiallar va sotuvdagi taomlar (noaniq tovush shularga moslanadi). */
  async vocabulary(): Promise<string[]> {
    const em = this.dataSource.manager;
    const [branches, products] = await Promise.all([
      em.find(Branch, { select: { name: true } }),
      em.find(Product, { where: { active: true }, select: { name: true } }),
    ]);
    return [...new Set([...branches.map((b) => b.name), ...products.map((p) => p.name.uz)])];
  }

  /** Tool'ni bajaradi. Xato modelga matn bo'lib qaytadi — so'rov yiqilmaydi. */
  async run(name: string | undefined, args: Args | undefined): Promise<ToolResponse> {
    const tool = this.tools.get(name ?? '');
    if (!tool) return { error: `unknown tool: ${name}` };
    try {
      return { output: await tool.run(args ?? {}) };
    } catch (error) {
      if (error instanceof ToolArgError) return { error: error.message };
      if (error instanceof HttpException) {
        const body = error.getResponse() as { code?: string; detail?: string };
        return { error: [body.code, body.detail].filter(Boolean).join(': ') };
      }
      this.logger.error(`${name}: ${(error as Error).message}`);
      return { error: 'internal error — data is unavailable right now' };
    }
  }

  // ───────────────────────── yordamchilar ─────────────────────────

  private async branchNames(): Promise<Map<string, string>> {
    const rows = await this.dataSource.manager.find(Branch, { select: { id: true, name: true } });
    return new Map(rows.map((b) => [b.id, b.name]));
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const rows = await this.dataSource.manager.find(User, { where: { id: In(unique) }, select: { id: true, name: true } });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  /** Filial id'si mavjudligi — model noto'g'ri id bersa, to'g'rilari ro'yxati bilan xato. */
  private branchArg(args: Args, names: Map<string, string>): string | null {
    const id = text(args, 'branchId');
    if (!id) return null;
    if (!names.has(id)) throw new ToolArgError(`unknown branchId ${id}; known: ${[...names.keys()].join(', ')}`);
    return id;
  }

  // ───────────────────────── tool'lar ─────────────────────────

  private salesReport(): Tool {
    return {
      declaration: {
        name: 'sales_report',
        description:
          'Sales report for a period: revenue (paid orders), order count, average check, cancelled orders, revenue ' +
          'by payment method (cash, card, click), by order type (dine_in, takeaway, delivery), by source (cashier, ' +
          'kiosk, mobile app), utility expenses by kind and net (revenue minus utility expenses), per-branch totals, ' +
          'sales of every product (qty and revenue, best first) and active menu items with no sales at all ' +
          '(notSold), the busiest hours and a per-day breakdown ' +
          '(per-month for periods longer than 3 months). Use it for daily / weekly / monthly revenue, delivery ' +
          'revenue, best and worst selling products and branch comparisons.',
        parameters: { type: Type.OBJECT, properties: { ...PERIOD, branchId: BRANCH }, required: ['from', 'to'] },
      },
      run: async (args) => {
        const period = periodArgs(args);
        const names = await this.branchNames();
        const branchId = this.branchArg(args, names);
        const [report, menu] = await Promise.all([
          this.reports.sales({ ...period, branchId }),
          this.dataSource.manager.find(Product, { where: { active: true }, select: { id: true, name: true } }),
        ]);
        const sold = new Set(report.topProducts.map((p) => p.productId));
        const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;
        return {
          period,
          branch: branchId ? names.get(branchId) : 'all branches',
          revenue: report.revenue,
          orders: report.orders,
          avgCheck: report.avgCheck,
          cancelled: { orders: report.cancelled, amount: report.cancelledAmount },
          byPayment: report.byPayment,
          byType: report.byType,
          bySource: report.bySource,
          utilityExpenses: report.expenses,
          expensesByKind: report.expensesByKind,
          net: report.net,
          byBranch: report.byBranch.map((b) => ({
            branch: names.get(b.branchId) ?? b.branchId,
            orders: b.orders,
            revenue: b.revenue,
            expenses: b.expenses,
            net: b.revenue - b.expenses,
          })),
          products: report.topProducts.map((p) => ({ name: p.name.uz, qty: p.qty, revenue: p.revenue })),
          // "eng kam sotilgan" savoliga — umuman sotilmaganlar ham (hisobotda ular yo'q)
          notSold: menu.filter((p) => !sold.has(p.id)).map((p) => p.name.uz),
          busiestHours: report.byHour
            .map((revenue, h) => ({ hours: `${hour(h)}–${hour((h + 1) % 24)}`, revenue }))
            .filter((h) => h.revenue > 0)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5),
          ...(report.days.length <= DAYS_LIMIT ? { days: report.days } : { months: byMonth(report.days) }),
        };
      },
    };
  }

  private currentStatus(): Tool {
    return {
      declaration: {
        name: 'current_status',
        description:
          'What is happening right now: every branch with whether it is working (a cashier shift is open), the ' +
          'cashiers on shift, active orders (waiting or being prepared), work hours and the mobile-app ordering ' +
          'state (open = accepts online orders; no_kassa = shift open but no cashier screen connected; no_shift = ' +
          'no open shift; off_hours = outside work hours; paused = stopped by admin; inactive = branch disabled). ' +
          'Also couriers on duty, low-stock item count and purchases awaiting approval.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      run: async () => {
        const now = new Date();
        const em = this.dataSource.manager;
        const [branches, overview, openShifts, couriersOnDuty] = await Promise.all([
          this.branches.findAll(now),
          this.reports.overview(),
          em.find(Shift, { where: { closedAt: IsNull() } }),
          em.count(User, { where: { role: 'courier', active: true, onDuty: true } }),
        ]);
        const cashiers = await this.userNames(openShifts.map((s) => s.cashierId));
        return {
          now: localTime(now),
          branches: branches.map((b) => {
            const shifts = openShifts.filter((s) => s.branchId === b.id);
            return {
              id: b.id,
              name: b.name,
              active: b.active,
              working: shifts.length > 0,
              cashiersOnShift: shifts.map((s) => cashiers.get(s.cashierId) ?? s.cashierId),
              activeOrders: overview.liveOrders.find((row) => row.branchId === b.id)?.count ?? 0,
              workHours: b.workHours ? `${b.workHours.open}–${b.workHours.close}` : '24/7',
              mobileOrdering: b.onlineState,
            };
          }),
          couriersOnDuty,
          lowStockItems: overview.lowStock,
          purchasesAwaitingApproval: overview.pendingPurchases,
        };
      },
    };
  }

  private shiftList(): Tool {
    return {
      declaration: {
        name: 'shifts',
        description:
          'Cashier shifts overlapping a period (open shifts first, then newest): branch, cashier, opened / closed ' +
          'time, paid orders, cancelled orders, revenue and revenue by payment method, plus totals. Use it for ' +
          '"how much did each shift / cashier make". A shift revenue is the total of the WHOLE shift — a shift can ' +
          'span several days (e.g. left open overnight), so it is not the revenue of one day: for a day or period ' +
          'revenue use sales_report, and say when a shift started on another day or is still open.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            ...PERIOD,
            branchId: BRANCH,
            openOnly: { type: Type.BOOLEAN, description: 'true — only shifts that are open now' },
          },
          required: ['from', 'to'],
        },
      },
      run: async (args) => {
        const period = periodArgs(args);
        const names = await this.branchNames();
        const branchId = this.branchArg(args, names);
        const result = await this.shifts.findAll({
          ...isoRange(period),
          ...(branchId && { branchId }),
          ...(args.openOnly === true && { open: true }),
          limit: 100,
        });
        const cashiers = await this.userNames(result.items.map((s) => s.cashierId));
        return {
          totals: {
            shifts: result.summary.count,
            openNow: result.summary.open,
            revenue: result.summary.revenue,
            cash: result.summary.cash,
          },
          shown: result.items.length,
          shifts: result.items.map((s) => ({
            branch: names.get(s.branchId) ?? s.branchId,
            cashier: cashiers.get(s.cashierId) ?? s.cashierId,
            openedAt: localTime(s.openedAt),
            closedAt: localTime(s.closedAt) ?? 'still open',
            orders: s.summary.orderCount,
            cancelled: s.summary.cancelledCount,
            revenue: s.summary.total,
            byPayment: s.summary.byPayment,
          })),
        };
      },
    };
  }

  private expenseList(): Tool {
    return {
      declaration: {
        name: 'expenses',
        description:
          'Utility expenses (electricity, gas, water, internet, other) entered for a period: total, totals by kind ' +
          'and by branch, and the list of entries.',
        parameters: { type: Type.OBJECT, properties: { ...PERIOD, branchId: BRANCH }, required: ['from', 'to'] },
      },
      run: async (args) => {
        const period = periodArgs(args);
        const names = await this.branchNames();
        const branchId = this.branchArg(args, names);
        const list = await this.expenses.findAll({ ...period, ...(branchId && { branchId }) });
        const byKind = Object.fromEntries(EXPENSE_KINDS.map((kind) => [kind, 0])) as Record<ExpenseKind, number>;
        const byBranch = new Map<string, number>();
        for (const e of list) {
          byKind[e.kind] += e.amount;
          byBranch.set(e.branchId, (byBranch.get(e.branchId) ?? 0) + e.amount);
        }
        return {
          total: list.reduce((sum, e) => sum + e.amount, 0),
          byKind,
          byBranch: [...byBranch].map(([id, amount]) => ({ branch: names.get(id) ?? id, amount })),
          entries: list.slice(0, 200).map((e) => ({
            date: e.date,
            branch: names.get(e.branchId) ?? e.branchId,
            kind: e.kind,
            amount: e.amount,
            ...(e.note && { note: e.note }),
          })),
        };
      },
    };
  }

  private purchaseList(): Tool {
    return {
      declaration: {
        name: 'purchases',
        description:
          'Ingredient purchases (stock receipts entered by the supplier) created in a period: money spent on ' +
          'approved purchases, purchases awaiting approval, spending per ingredient and the latest purchase ' +
          'documents. Use it for "how much was spent on products / ingredients".',
        parameters: {
          type: Type.OBJECT,
          properties: {
            ...PERIOD,
            status: choice(PURCHASE_STATUSES, 'Only purchases with this status'),
            warehouseId: { type: Type.STRING, description: 'Warehouse id from the list. Omit for all' },
          },
          required: ['from', 'to'],
        },
      },
      run: async (args) => {
        const period = periodArgs(args);
        const status = oneOf(args, 'status', PURCHASE_STATUSES);
        const warehouseId = text(args, 'warehouseId');
        const em = this.dataSource.manager;
        const range = isoRange(period);
        const qb = em
          .createQueryBuilder(Purchase, 'p')
          .where('p.createdAt >= :from AND p.createdAt < :to', range)
          .orderBy('p.createdAt', 'DESC');
        if (status) qb.andWhere('p.status = :status', { status });
        if (warehouseId) qb.andWhere('p.warehouseId = :warehouseId', { warehouseId });
        const [purchases, ingredients, warehouses, branchNames] = await Promise.all([
          qb.getMany(),
          em.find(Ingredient),
          em.find(Warehouse),
          this.branchNames(),
        ]);
        const ingredient = new Map(ingredients.map((i) => [i.id, i]));
        const warehouse = new Map(warehouses.map((w) => [w.id, warehouseLabel(w, branchNames)]));
        const amount = (p: Purchase) => Math.round(p.items.reduce((sum, i) => sum + i.qty * (i.price ?? 0), 0));

        const spent = new Map<string, { qty: number; amount: number }>();
        for (const p of purchases.filter((p) => p.status === 'approved')) {
          for (const item of p.items) {
            const row = spent.get(item.ingredientId) ?? { qty: 0, amount: 0 };
            row.qty += item.qty;
            row.amount += item.qty * (item.price ?? 0);
            spent.set(item.ingredientId, row);
          }
        }
        const approved = purchases.filter((p) => p.status === 'approved');
        const pending = purchases.filter((p) => p.status === 'pending');
        return {
          approved: { count: approved.length, amount: approved.reduce((sum, p) => sum + amount(p), 0) },
          awaitingApproval: { count: pending.length, amountAtKnownPrices: pending.reduce((sum, p) => sum + amount(p), 0) },
          rejected: purchases.filter((p) => p.status === 'rejected').length,
          spendingByIngredient: [...spent]
            .map(([id, row]) => ({
              name: ingredient.get(id)?.name.uz ?? id,
              qty: round3(row.qty),
              unit: unitLabel(ingredient.get(id)?.unit),
              amount: Math.round(row.amount),
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 25),
          latest: purchases.slice(0, 20).map((p) => ({
            number: p.number,
            warehouse: warehouse.get(p.warehouseId) ?? p.warehouseId,
            status: p.status,
            createdAt: localTime(p.createdAt),
            amount: amount(p),
            items: p.items.map((i) => ({
              name: ingredient.get(i.ingredientId)?.name.uz ?? i.ingredientId,
              qty: i.qty,
              unit: unitLabel(ingredient.get(i.ingredientId)?.unit),
              price: i.price,
            })),
          })),
        };
      },
    };
  }

  private stock(): Tool {
    return {
      declaration: {
        name: 'stock',
        description:
          'Current warehouse stock of ingredients and packaging: quantity in the item unit (kg, l, dona), the warning minimum ' +
          'and status (out = nothing left or negative, low = below the minimum, ok). Use lowOnly for "what is ' +
          'running out".',
        parameters: {
          type: Type.OBJECT,
          properties: {
            warehouseId: { type: Type.STRING, description: 'Warehouse id from the list. Omit for all warehouses' },
            lowOnly: { type: Type.BOOLEAN, description: 'true — only items that are out or below the minimum' },
            search: { type: Type.STRING, description: 'Part of the item name (any language)' },
          },
        },
      },
      run: async (args) => {
        const warehouseId = text(args, 'warehouseId');
        const search = text(args, 'search')?.toLowerCase();
        const em = this.dataSource.manager;
        const [rows, ingredients, warehouses, branchNames] = await Promise.all([
          em.find(StockItem, { where: warehouseId ? { warehouseId } : {} }),
          em.find(Ingredient, { where: { active: true } }),
          em.find(Warehouse),
          this.branchNames(),
        ]);
        const ingredient = new Map(ingredients.map((i) => [i.id, i]));
        const warehouse = new Map(warehouses.map((w) => [w.id, warehouseLabel(w, branchNames)]));
        const ORDER = { out: 0, low: 1, ok: 2 } as const;
        const items = rows
          .filter((row) => ingredient.has(row.ingredientId))
          .map((row) => {
            const item = ingredient.get(row.ingredientId)!;
            const status: keyof typeof ORDER =
              row.qty <= 0 ? 'out' : row.minQty > 0 && row.qty < row.minQty ? 'low' : 'ok';
            return {
              warehouse: warehouse.get(row.warehouseId) ?? row.warehouseId,
              name: item.name.uz,
              names: item.name,
              qty: round3(fromBase(row.qty, item.unit)),
              unit: UNIT_LABEL[item.unit],
              min: row.minQty > 0 ? round3(fromBase(row.minQty, item.unit)) : null,
              status,
            };
          })
          .filter((item) => (args.lowOnly === true ? item.status !== 'ok' : true))
          .filter((item) => !search || Object.values(item.names).some((n) => n.toLowerCase().includes(search)))
          .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.warehouse.localeCompare(b.warehouse))
          .map(({ names: _names, ...item }) => item);
        return {
          count: items.length,
          out: items.filter((i) => i.status === 'out').length,
          low: items.filter((i) => i.status === 'low').length,
          items: items.slice(0, 300),
        };
      },
    };
  }

  private menu(): Tool {
    return {
      declaration: {
        name: 'menu',
        description:
          'The menu: categories in menu order, each with its products and prices (the same price in every branch). ' +
          'Products temporarily not sold in some branches have notSoldAt. Switched-off products are listed in ' +
          'offMenu. Use it for "what dishes do we have", prices and assortment; for sales numbers use sales_report.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      run: async () => {
        const em = this.dataSource.manager;
        const [categories, products, branchNames] = await Promise.all([
          em.find(Category, { order: { sortOrder: 'ASC' } }),
          em.find(Product, { order: { sortOrder: 'ASC' } }),
          this.branchNames(),
        ]);
        // kassa / kiosk menyusidagidek: faol kategoriyadagi faol taom
        const shown = categories.filter((c) => c.active);
        const shownIds = new Set(shown.map((c) => c.id));
        return {
          categories: shown
            .map((c) => ({
              name: c.name.uz,
              products: products
                .filter((p) => p.active && p.categoryId === c.id)
                .map((p) => {
                  const notSoldAt = p.unavailableBranchIds.flatMap((id) => branchNames.get(id) ?? []);
                  return { name: p.name.uz, price: p.price, ...(notSoldAt.length > 0 && { notSoldAt }) };
                }),
            }))
            .filter((c) => c.products.length > 0),
          offMenu: products.filter((p) => !p.active || !shownIds.has(p.categoryId)).map((p) => p.name.uz),
        };
      },
    };
  }

  private orderList(): Tool {
    return {
      declaration: {
        name: 'orders',
        description:
          'Orders created in a period with optional filters: totals (all, paid, cancelled, not yet paid / accepted) ' +
          'and the 30 newest orders (number, branch, time, type, source, status, total, payment, items, courier ' +
          'delivery times). Use it to look up specific orders or count cancelled / pending ones; for revenue ' +
          'totals prefer sales_report.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            ...PERIOD,
            branchId: BRANCH,
            type: choice(ORDER_TYPES, 'Order type'),
            source: choice(ORDER_SOURCES, 'Where the order came from'),
            status: choice(ORDER_STATUSES, 'Order status'),
            payment: choice(PAYMENT_METHODS, 'Payment method'),
            number: { type: Type.INTEGER, description: 'Order number (daily, per branch)' },
          },
          required: ['from', 'to'],
        },
      },
      run: async (args) => {
        const period = periodArgs(args);
        const names = await this.branchNames();
        const branchId = this.branchArg(args, names);
        const type = oneOf(args, 'type', ORDER_TYPES);
        const source = oneOf(args, 'source', ORDER_SOURCES);
        const status = oneOf(args, 'status', ORDER_STATUSES);
        const payment = oneOf(args, 'payment', PAYMENT_METHODS);
        const number = typeof args.number === 'number' ? Math.trunc(args.number) : undefined;
        const result = await this.orders.findAll({
          ...isoRange(period),
          ...(branchId && { branchId }),
          ...(type && { type }),
          ...(source && { source }),
          ...(status && { status }),
          ...(payment && { payment }),
          ...(number !== undefined && { number }),
          limit: 30,
        });
        const couriers = await this.userNames(result.items.map((o) => o.courierId));
        return {
          totals: result.summary,
          shown: result.items.length,
          orders: result.items.map((o) => ({
            number: o.number,
            branch: names.get(o.branchId) ?? o.branchId,
            createdAt: localTime(o.createdAt),
            type: o.type,
            source: o.source,
            status: o.status,
            total: o.total,
            payment: o.split ?? o.payment,
            items: o.items.map((i) => `${i.qty} × ${i.name.uz}`),
            ...(o.cancelReason && { cancelReason: o.cancelReason }),
            ...(o.type === 'delivery' && {
              delivery: {
                courier: o.courierId ? (couriers.get(o.courierId) ?? o.courierId) : null,
                deliveredAt: localTime(o.deliveredAt),
                returnedAt: localTime(o.returnedAt),
                fee: o.deliveryFee,
              },
            }),
          })),
        };
      },
    };
  }
}
