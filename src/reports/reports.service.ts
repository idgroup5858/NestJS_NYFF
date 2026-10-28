import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  EXPENSE_KINDS,
  ORDER_TYPES,
  PAYMENT_METHODS,
  type ExpenseKind,
  type OrderSource,
  type OrderType,
  type PaymentMethod,
} from '../common/enums';
import { fail } from '../common/errors';
import type { LocalizedText } from '../common/types';
import { appTimeZone, dateRange, isRealDateKey, type DateKey } from '../domain/dates';
import { PAID_STATUS_SQL, paymentPartSql } from '../shifts/shift-summary';

/** Frontend `src/domain/logic/reports.ts` dagi turlar bilan bir xil — UI javobni o'zgartirmasdan ishlatadi. */
export interface ReportRange {
  from: DateKey;
  to: DateKey;
  /** `null` — barcha filiallar */
  branchId: string | null;
}

export interface Tally {
  orders: number;
  revenue: number;
}

export interface DayPoint extends Tally {
  date: DateKey;
  expenses: number;
}

export interface ProductStat {
  productId: string;
  name: LocalizedText;
  qty: number;
  revenue: number;
}

export interface BranchStat extends Tally {
  branchId: string;
  expenses: number;
}

export interface SalesReport extends Tally {
  cancelled: number;
  cancelledAmount: number;
  avgCheck: number;
  byPayment: Record<PaymentMethod, number>;
  byType: Record<OrderType, Tally>;
  bySource: Record<OrderSource, Tally>;
  /** soat bo'yicha tushum (0–23) */
  byHour: number[];
  /** oraliqdagi har bir kun — buyurtmasiz kunlar ham (0 bilan) */
  days: DayPoint[];
  /** tushum bo'yicha kamayish tartibida */
  topProducts: ProductStat[];
  byBranch: BranchStat[];
  expenses: number;
  expensesByKind: Record<ExpenseKind, number>;
  /** tushum − kommunal xarajatlar */
  net: number;
}

/** Admin bosh sahifasidagi "hozir" kartochkalari. */
export interface Overview {
  /** faol filiallar: kutilayotgan va tayyorlanayotgan buyurtmalar soni */
  liveOrders: { branchId: string; count: number }[];
  /** chegarasi qo'yilgan va qoldig'i chegaradan kam ombor yozuvlari */
  lowStock: number;
  /** tasdiq kutayotgan kirimlar */
  pendingPurchases: number;
  /** birinchi buyurtma kuni (mahalliy sana) — undan oldingi davr bilan solishtirish ma'nosiz; `null` — buyurtma yo'q */
  firstOrderDate: DateKey | null;
}

const tally = (): Tally => ({ orders: 0, revenue: 0 });

/** Postgres `bigint` / `numeric` / `count` matn bo'lib qaytadi. */
const num = (value: string | number | null | undefined): number => Number(value ?? 0);

type TallyDim = 'total' | 'type' | 'source' | 'hour' | 'day' | 'branch';

interface TallyRow {
  dim: TallyDim;
  key: string | null;
  orders: string;
  revenue: string;
  cancelled: string;
  cancelledAmount: string;
  cash: string;
  card: string;
  click: string;
}

interface ProductRow {
  productId: string;
  name: LocalizedText;
  qty: string;
  revenue: string;
}

interface ExpenseRow {
  branchId: string;
  kind: ExpenseKind;
  date: DateKey;
  amount: string;
}

@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Sotuv hisoboti (frontend `salesReport` bilan bir xil natija): to'langan (bekor qilinmagan) buyurtmalar tushumi
   * to'lov turi / buyurtma turi / manba / soat / kun / taom / filial kesimida va shu davrdagi kommunal xarajatlar.
   * Buyurtma kuni va soati — ilova vaqt zonasidagi mahalliy vaqt. Hammasi bitta suratdan (REPEATABLE READ): jami,
   * taomlar va filiallar bir-biriga mos keladi.
   */
  async sales(range: ReportRange): Promise<SalesReport> {
    if (!isRealDateKey(range.from)) fail('invalid_input', `from: ${range.from}`);
    if (!isRealDateKey(range.to)) fail('invalid_input', `to: ${range.to}`);

    // frontend kabi: kunlar ro'yxati eng ko'pi 400 ta, undan keyingi kunlar hisobotga kirmaydi; `from > to` — bo'sh
    const days = dateRange(range.from, range.to);
    const dayIndex = new Map(days.map((date, index) => [date, index]));
    const branchId = range.branchId;

    return this.dataSource.transaction('REPEATABLE READ', async (em) => {
      const branches: { id: string }[] = await em.query(
        `SELECT b.id FROM branches b ${branchId !== null ? 'WHERE b.id = $1' : ''} ORDER BY b."createdAt", b.name`,
        branchId !== null ? [branchId] : [],
      );

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
        byBranch: branches.map((b) => ({ branchId: b.id, ...tally(), expenses: 0 })),
        expenses: 0,
        expensesByKind: Object.fromEntries(EXPENSE_KINDS.map((k) => [k, 0])) as Record<ExpenseKind, number>,
        net: 0,
      };
      if (days.length === 0) return report;

      const scope = { from: days[0], to: days[days.length - 1], branchId };
      const branchStat = new Map(report.byBranch.map((b) => [b.branchId, b]));
      // tranzaksiya bitta ulanishda — so'rovlar ketma-ket
      const tallies = await this.tallies(em, scope);
      const products = await this.topProducts(em, scope);
      const expenses = await this.expenses(em, scope);

      for (const row of tallies) {
        const add = (target: Tally) => {
          target.orders += num(row.orders);
          target.revenue += num(row.revenue);
        };
        const key = row.key ?? '';
        if (row.dim === 'total') {
          add(report);
          report.cancelled = num(row.cancelled);
          report.cancelledAmount = num(row.cancelledAmount);
          for (const method of PAYMENT_METHODS) report.byPayment[method] = num(row[method]);
        } else if (row.dim === 'type') {
          add((report.byType[key as OrderType] ??= tally()));
        } else if (row.dim === 'source') {
          add((report.bySource[key as OrderSource] ??= tally()));
        } else if (row.dim === 'hour') {
          report.byHour[Number(key)] += num(row.revenue);
        } else if (row.dim === 'day') {
          const index = dayIndex.get(key);
          if (index !== undefined) add(report.days[index]);
        } else {
          const branch = branchStat.get(key);
          if (branch) add(branch);
        }
      }

      report.topProducts = products.map((row) => ({
        productId: row.productId,
        name: row.name,
        qty: num(row.qty),
        revenue: num(row.revenue),
      }));

      for (const row of expenses) {
        const amount = num(row.amount);
        report.expenses += amount;
        report.expensesByKind[row.kind] = (report.expensesByKind[row.kind] ?? 0) + amount;
        const index = dayIndex.get(row.date);
        if (index !== undefined) report.days[index].expenses += amount;
        const branch = branchStat.get(row.branchId);
        if (branch) branch.expenses += amount;
      }

      report.avgCheck = report.orders > 0 ? Math.round(report.revenue / report.orders) : 0;
      report.net = report.revenue - report.expenses;
      return report;
    });
  }

  /** Admin bosh sahifasi: filiallardagi jonli buyurtmalar, kam qolgan mahsulotlar, tasdiq kutayotgan kirimlar. */
  async overview(): Promise<Overview> {
    const em = this.dataSource.manager;
    const [live, [counts]] = await Promise.all([
      em.query<{ branchId: string; count: string }[]>(
        `SELECT b.id AS "branchId", COUNT(o.id) AS count
         FROM branches b
         LEFT JOIN orders o ON o."branchId" = b.id AND o.status IN ('pending', 'preparing')
         WHERE b.active
         GROUP BY b.id
         ORDER BY b."createdAt", b.name`,
      ),
      em.query<{ lowStock: string; pendingPurchases: string; firstOrderDate: DateKey | null }[]>(
        `SELECT
           (SELECT COUNT(*) FROM stock s WHERE s."minQty" > 0 AND s.qty < s."minQty") AS "lowStock",
           (SELECT COUNT(*) FROM purchases p WHERE p.status = 'pending') AS "pendingPurchases",
           (SELECT to_char(MIN(o."createdAt" AT TIME ZONE $1), 'YYYY-MM-DD') FROM orders o) AS "firstOrderDate"`,
        [appTimeZone()],
      ),
    ]);
    return {
      liveOrders: live.map((row) => ({ branchId: row.branchId, count: num(row.count) })),
      lowStock: num(counts.lowStock),
      pendingPurchases: num(counts.pendingPurchases),
      firstOrderDate: counts.firstOrderDate,
    };
  }

  /**
   * Bitta so'rovda barcha kesimlar (GROUPING SETS): jami (bekor qilinganlar va to'lov turlari bilan), buyurtma
   * turi, manba, soat, kun, filial. Har bir qatorda `dim` — qaysi kesim, `key` — uning qiymati.
   */
  private tallies(em: EntityManager, scope: ScopeArgs): Promise<TallyRow[]> {
    const { sql, params } = ordersInScope(scope);
    const payments = PAYMENT_METHODS.map(
      (method) =>
        `COALESCE(SUM(${paymentPartSql(method)}) FILTER (WHERE ${PAID_STATUS_SQL}), 0) AS "${method}"`,
    ).join(',\n');
    return em.query(
      `SELECT
         CASE
           WHEN GROUPING(o.type) = 0 THEN 'type'
           WHEN GROUPING(o.source) = 0 THEN 'source'
           WHEN GROUPING(o.hour) = 0 THEN 'hour'
           WHEN GROUPING(o.day) = 0 THEN 'day'
           WHEN GROUPING(o."branchId") = 0 THEN 'branch'
           ELSE 'total'
         END AS dim,
         COALESCE(o.type, o.source, o.hour::text, to_char(o.day, 'YYYY-MM-DD'), o."branchId") AS key,
         COUNT(*) FILTER (WHERE ${PAID_STATUS_SQL}) AS orders,
         COALESCE(SUM(o.total) FILTER (WHERE ${PAID_STATUS_SQL}), 0) AS revenue,
         COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
         COALESCE(SUM(o.total) FILTER (WHERE o.status = 'cancelled'), 0) AS "cancelledAmount",
         ${payments}
       FROM (${sql}) o
       GROUP BY GROUPING SETS ((), (o.type), (o.source), (o.hour), (o.day), (o."branchId"))`,
      params,
    );
  }

  /**
   * Taomlar: buyurtma qatorlari (`items` jsonb) bo'yicha soni va tushumi (narx × soni). Nomi — taom birinchi
   * uchragan (eng oldingi) buyurtmadagi nom; tushumi teng bo'lsa ham birinchi uchragan oldin (frontend tartibi).
   */
  private topProducts(em: EntityManager, scope: ScopeArgs): Promise<ProductRow[]> {
    const { sql, params } = ordersInScope(scope);
    return em.query(
      `SELECT x."productId",
         (array_agg(x.name ORDER BY x.seq))[1] AS name,
         SUM(x.qty) AS qty,
         SUM(x.price * x.qty) AS revenue
       FROM (
         SELECT e.item->>'productId' AS "productId",
           e.item->'name' AS name,
           (e.item->>'qty')::numeric AS qty,
           (e.item->>'price')::numeric AS price,
           row_number() OVER (ORDER BY o."createdAt", o.id, e.pos) AS seq
         FROM (${sql}) o
         CROSS JOIN LATERAL jsonb_array_elements(o.items) WITH ORDINALITY AS e(item, pos)
         WHERE ${PAID_STATUS_SQL}
       ) x
       GROUP BY x."productId"
       ORDER BY revenue DESC, MIN(x.seq)`,
      params,
    );
  }

  /** Kommunal xarajatlar filial / tur / kun bo'yicha (sanasi — mahalliy kun, vaqt zonasi kerak emas). */
  private expenses(em: EntityManager, scope: ScopeArgs): Promise<ExpenseRow[]> {
    const params: unknown[] = [scope.from, scope.to];
    if (scope.branchId !== null) params.push(scope.branchId);
    return em.query(
      `SELECT e."branchId", e.kind, to_char(e.date, 'YYYY-MM-DD') AS date, SUM(e.amount) AS amount
       FROM expenses e
       WHERE e.date BETWEEN $1::date AND $2::date ${scope.branchId !== null ? 'AND e."branchId" = $3' : ''}
       GROUP BY e."branchId", e.kind, e.date`,
      params,
    );
  }
}

interface ScopeArgs {
  from: DateKey;
  to: DateKey;
  branchId: string | null;
}

/**
 * Hisobot oralig'idagi buyurtmalar (`o.*` + mahalliy `day` va `hour`), `pending` siz — ular hisobotga umuman
 * kirmaydi. `createdAt` oralig'i — indeks uchun; aniq shart — mahalliy kun [from, to] ichida (frontend `dateKey`).
 */
function ordersInScope(scope: ScopeArgs): { sql: string; params: unknown[] } {
  const params: unknown[] = [appTimeZone(), scope.from, scope.to];
  if (scope.branchId !== null) params.push(scope.branchId);
  const sql = `SELECT o.*,
      (o."createdAt" AT TIME ZONE $1)::date AS day,
      EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE $1)::int AS hour
    FROM orders o
    WHERE o."createdAt" >= ($2::date::timestamp AT TIME ZONE $1)
      AND o."createdAt" < (($3::date + 1)::timestamp AT TIME ZONE $1)
      AND (o."createdAt" AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
      AND o.status <> 'pending'
      ${scope.branchId !== null ? 'AND o."branchId" = $4' : ''}`;
  return { sql, params };
}
