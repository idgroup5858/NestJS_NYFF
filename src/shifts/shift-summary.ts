import type { EntityManager } from 'typeorm';
import { PAYMENT_METHODS, type PaymentMethod } from '../common/enums';

export interface ShiftSummary {
  orderCount: number;
  cancelledCount: number;
  total: number;
  byPayment: Record<PaymentMethod, number>;
}

export const emptyShiftSummary = (): ShiftSummary => ({
  orderCount: 0,
  cancelledCount: 0,
  total: 0,
  byPayment: { cash: 0, card: 0, click: 0 },
});

/** Hisobga kiradigan (to'langan, bekor qilinmagan) buyurtma: kassada to'lanmagan `pending` va `cancelled` — yo'q. */
export const PAID_STATUS_SQL = `o.status IN ('preparing', 'ready')`;

/**
 * Buyurtmaning [method] bo'yicha tushumi (SQL ifoda): aralash to'lovda — o'sha qismi, aks holda — butun summa.
 * Frontend `orderPayments()` bilan bir xil.
 */
export function paymentPartSql(method: PaymentMethod): string {
  return `CASE WHEN o.split IS NOT NULL THEN COALESCE((o.split->>'${method}')::bigint, 0)
    WHEN o.payment = '${method}' THEN o.total ELSE 0 END`;
}

/** Smenalar tushumi (bekor qilinganlar — faqat soni, to'lanmaganlar — hisobga kirmaydi); buyurtmasiz smena — 0. */
export async function shiftSummaries(em: EntityManager, shiftIds: string[]): Promise<Map<string, ShiftSummary>> {
  const result = new Map(shiftIds.map((id) => [id, emptyShiftSummary()]));
  if (shiftIds.length === 0) return result;
  const parts = PAYMENT_METHODS.map(
    (method) => `COALESCE(SUM(${paymentPartSql(method)}) FILTER (WHERE ${PAID_STATUS_SQL}), 0) AS "${method}"`,
  ).join(',\n');
  const rows: Record<string, string>[] = await em.query(
    `SELECT o."shiftId" AS "shiftId",
       COUNT(*) FILTER (WHERE ${PAID_STATUS_SQL}) AS "orderCount",
       COUNT(*) FILTER (WHERE o.status = 'cancelled') AS "cancelledCount",
       COALESCE(SUM(o.total) FILTER (WHERE ${PAID_STATUS_SQL}), 0) AS "total",
       ${parts}
     FROM orders o WHERE o."shiftId" = ANY($1) GROUP BY o."shiftId"`,
    [shiftIds],
  );
  for (const row of rows) {
    result.set(row.shiftId, {
      orderCount: Number(row.orderCount),
      cancelledCount: Number(row.cancelledCount),
      total: Number(row.total),
      byPayment: { cash: Number(row.cash), card: Number(row.card), click: Number(row.click) },
    });
  }
  return result;
}
