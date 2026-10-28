import { PAYMENT_METHODS, type PaymentMethod } from '../common/enums';
import { fail } from '../common/errors';
import type { PaymentSplit } from '../common/types';

/** Buyurtma tushumi to'lov turlari bo'yicha (smena va hisobotlar uchun): aralashda — qismlar, aks holda — butun summa. */
export function orderPayments(order: {
  split: PaymentSplit | null;
  payment: PaymentMethod | null;
  total: number;
}): Record<PaymentMethod, number> {
  const result: Record<PaymentMethod, number> = { cash: 0, card: 0, click: 0 };
  if (order.split) for (const method of PAYMENT_METHODS) result[method] = order.split[method] ?? 0;
  else if (order.payment) result[order.payment] = order.total;
  return result;
}

/** Aralash to'lovni tekshiradi: musbat butun qismlar, kamida ikkita tur, yig'indisi — aynan buyurtma summasi. */
function cleanSplit(split: PaymentSplit, total: number): PaymentSplit {
  const parts = PAYMENT_METHODS.filter((method) => (split[method] ?? 0) !== 0).map(
    (method) => [method, split[method] ?? 0] as const,
  );
  if (parts.length < 2 || parts.some(([, amount]) => !Number.isInteger(amount) || amount < 0)) fail('invalid_amount');
  if (parts.reduce((sum, [, amount]) => sum + amount, 0) !== total) fail('invalid_amount');
  return Object.fromEntries(parts);
}

/** To'lov turi va aralash qismlari; aralashda asosiy tur — eng katta qism. */
export function resolvePayment(
  payment: PaymentMethod,
  split: PaymentSplit | null | undefined,
  total: number,
): { payment: PaymentMethod; split: PaymentSplit | null } {
  if (!split) return { payment, split: null };
  const clean = cleanSplit(split, total);
  return {
    payment: PAYMENT_METHODS.reduce((best, method) => ((clean[method] ?? 0) > (clean[best] ?? 0) ? method : best)),
    split: clean,
  };
}
