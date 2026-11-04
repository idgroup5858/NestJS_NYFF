import type { EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { Branch } from '../branches/branch.entity';
import {
  ORDER_SOURCES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  type OrderSource,
  type OrderType,
  type PaymentMethod,
} from '../common/enums';
import { fail } from '../common/errors';
import { Order } from '../orders/order.entity';
import { Shift } from '../shifts/shift.entity';
import { shiftSummaries, type ShiftSummary } from '../shifts/shift-summary';
import { fullName, User } from '../users/user.entity';
import { dateTime, som } from './format';
import { loadBranchLowStock, lowStockLine, type LowStockLine } from './low-stock';

/** Hisobotda eng ko'p sotilgan nechta taom ko'rsatiladi. */
const TOP_PRODUCTS = 5;

/** Yopilgan smena hisoboti — Telegram botga (ulangan admin chatlariga) yuboriladi. */
export interface ShiftReport {
  branchName: string;
  cashierName: string;
  /** smenani admin yopgan bo'lsa — uning ismi; kassir o'zi yopsa — `null` */
  closedByName: string | null;
  openedAt: Date;
  closedAt: Date;
  /** to'langanlar soni, tushum va to'lov turlari — kassadagi "Smenani topshirish" bilan bir xil */
  summary: ShiftSummary;
  /** to'lab bo'lingach bekor qilinganlar summasi (soni — `summary.cancelledCount`) */
  cancelledAmount: number;
  byType: Record<OrderType, { count: number; amount: number }>;
  bySource: Record<OrderSource, number>;
  /** soni bo'yicha, ko'pi birinchi */
  topProducts: { name: string; qty: number }[];
  /** filial omborida hisobot paytida chegaradan kam qolganlar (nomi bo'yicha) */
  lowStock: LowStockLine[];
}

const TYPE_LABEL: Record<OrderType, string> = {
  dine_in: 'Zalda',
  takeaway: 'Olib ketish',
  delivery: 'Dostavka',
};
const SOURCE_LABEL: Record<OrderSource, string> = { cashier: 'Kassa', kiosk: 'Kiosk', mobile: 'Mobil ilova' };
const PAYMENT_LABEL: Record<PaymentMethod, string> = { cash: 'Naqd', card: 'Karta', click: 'Click' };

/** Hisobga kiradigan buyurtma — `PAID_STATUS_SQL` bilan bir xil. */
const isPaid = (order: Order) => order.status === 'preparing' || order.status === 'ready';

export async function loadShiftReport(
  em: EntityManager,
  shiftId: string,
  closedBy: AuthUser | null,
): Promise<ShiftReport> {
  const shift = (await em.findOneBy(Shift, { id: shiftId })) ?? fail('not_found', `shift ${shiftId}`);
  const [branch, cashier, orders, summaries, lowStock] = await Promise.all([
    em.findOneBy(Branch, { id: shift.branchId }),
    em.findOneBy(User, { id: shift.cashierId }),
    em.find(Order, { where: { shiftId }, order: { createdAt: 'ASC', id: 'ASC' } }),
    shiftSummaries(em, [shiftId]),
    loadBranchLowStock(em, shift.branchId),
  ]);

  const byType = Object.fromEntries(
    ORDER_TYPES.map((type) => [type, { count: 0, amount: 0 }]),
  ) as ShiftReport['byType'];
  const bySource = Object.fromEntries(ORDER_SOURCES.map((source) => [source, 0])) as ShiftReport['bySource'];
  const products = new Map<string, { name: string; qty: number }>();
  let cancelledAmount = 0;
  for (const order of orders) {
    if (order.status === 'cancelled') cancelledAmount += order.total;
    if (!isPaid(order)) continue;
    byType[order.type].count++;
    byType[order.type].amount += order.total;
    bySource[order.source]++;
    for (const item of order.items) {
      const product = products.get(item.productId) ?? {
        name: item.name.uz || item.name.ru || item.name.en,
        qty: 0,
      };
      product.qty += item.qty;
      products.set(item.productId, product);
    }
  }

  return {
    branchName: branch?.name ?? shift.branchId,
    cashierName: cashier ? fullName(cashier) : shift.cashierId,
    closedByName: closedBy && closedBy.id !== shift.cashierId ? fullName(closedBy) : null,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt ?? new Date(),
    summary: summaries.get(shiftId)!,
    cancelledAmount,
    byType,
    bySource,
    // soni teng bo'lsa — smenada birinchi sotilgani oldin (Map tartibi saqlanadi, sort barqaror)
    topProducts: [...products.values()].sort((a, b) => b.qty - a.qty).slice(0, TOP_PRODUCTS),
    lowStock,
  };
}

/** `8 soat 15 daqiqa`, `8 soat`, `40 daqiqa` */
function duration(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} daqiqa`;
  return rest ? `${hours} soat ${rest} daqiqa` : `${hours} soat`;
}

/**
 * Oddiy matn (Telegram'da Markdown'siz), adabiy tilda — tizim xabari, AI yozmaydi. Ro'yxat AI javoblaridagidek:
 * sarlavha va ikki bo'sh joy bilan surilgan «•» qatorlar. Nol qatorlar (to'lov turi, buyurtma turi, manba) chiqmaydi.
 */
export function shiftReportText(report: ShiftReport): string {
  const { summary } = report;
  const lines = [`Smena yopildi — ${report.branchName}`, `Kassir: ${report.cashierName}`];
  if (report.closedByName) lines.push(`Smenani admin yopdi: ${report.closedByName}`);
  lines.push(
    `Ochildi: ${dateTime(report.openedAt)}`,
    `Yopildi: ${dateTime(report.closedAt)} (${duration(report.openedAt, report.closedAt)})`,
    '',
    `Buyurtmalar: ${summary.orderCount} ta`,
    `Tushum: ${som(summary.total)}`,
  );
  for (const method of PAYMENT_METHODS) {
    if (summary.byPayment[method])
      lines.push(`  • ${PAYMENT_LABEL[method]}: ${som(summary.byPayment[method])}`);
  }
  if (summary.orderCount) lines.push(`O'rtacha chek: ${som(Math.round(summary.total / summary.orderCount))}`);
  if (summary.cancelledCount)
    lines.push(`Bekor qilingan: ${summary.cancelledCount} ta — ${som(report.cancelledAmount)}`);

  if (summary.orderCount) {
    lines.push('', "Turi bo'yicha:");
    for (const type of ORDER_TYPES) {
      const { count, amount } = report.byType[type];
      if (count) lines.push(`  • ${TYPE_LABEL[type]}: ${count} ta — ${som(amount)}`);
    }
    lines.push('', 'Qayerdan:');
    for (const source of ORDER_SOURCES) {
      if (report.bySource[source]) lines.push(`  • ${SOURCE_LABEL[source]}: ${report.bySource[source]} ta`);
    }
  }
  if (report.topProducts.length) {
    lines.push('', "Eng ko'p sotilgan:");
    report.topProducts.forEach((product, index) =>
      lines.push(`  ${index + 1}. ${product.name} — ${product.qty} ta`),
    );
  }
  if (report.lowStock.length) {
    lines.push('', 'Omborda kam qolgan:');
    for (const line of report.lowStock) lines.push(`  • ${lowStockLine(line)}`);
  }
  return lines.join('\n');
}
