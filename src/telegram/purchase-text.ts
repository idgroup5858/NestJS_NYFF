import { In, type EntityManager } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { Warehouse } from '../branches/warehouse.entity';
import { BASE_LABEL, num, packName, UNIT_LABEL } from '../domain/stock-text';
import { fullName, User } from '../users/user.entity';
import { Ingredient } from '../warehouse/ingredient.entity';
import type { Purchase } from '../warehouse/purchase.entity';
import { dateTime, som } from './format';

/** Kirim qatori — Telegram xabariga: miqdor va narx hujjat yozilgan paytdagi birlikda. */
export interface PurchaseNoticeLine {
  name: string;
  /** kirimdagi miqdor: kg / l / dona; qadoqli — donada (qadoqda) */
  qty: number;
  /** "kg", "l", "dona" yoki qadoq nomi ("dona" / "qadoq") */
  unit: string;
  /** qadoqli mahsulotda: "1 dona = 600 g" */
  pack: string | null;
  /** 1 birlik narxi; eski kirimda `null` bo'lishi mumkin */
  price: number | null;
}

export interface PurchaseNotice {
  number: number;
  warehouseName: string;
  authorName: string;
  createdAt: Date;
  lines: PurchaseNoticeLine[];
  note: string;
}

export async function loadPurchaseNotice(em: EntityManager, purchase: Purchase): Promise<PurchaseNotice> {
  const [warehouse, author, ingredients] = await Promise.all([
    em.findOneBy(Warehouse, { id: purchase.warehouseId }),
    em.findOneBy(User, { id: purchase.createdBy }),
    em.findBy(Ingredient, { id: In(purchase.items.map((item) => item.ingredientId)) }),
  ]);
  const branch = warehouse?.branchId ? await em.findOneBy(Branch, { id: warehouse.branchId }) : null;
  const ingredient = new Map(ingredients.map((i) => [i.id, i]));
  return {
    number: purchase.number,
    warehouseName:
      warehouse?.kind === 'central'
        ? 'Markaziy ombor'
        : branch
          ? `${branch.name} ombori`
          : (warehouse?.name ?? purchase.warehouseId),
    authorName: author ? fullName(author) : purchase.createdBy,
    createdAt: purchase.createdAt,
    note: purchase.note,
    lines: purchase.items.map((item) => {
      const found = ingredient.get(item.ingredientId);
      const unit = found?.unit ?? 'pcs';
      return {
        name: found ? found.name.uz || found.name.ru || found.name.en : item.ingredientId,
        qty: item.qty,
        unit: item.packSize === null ? UNIT_LABEL[unit] : packName(unit),
        pack: item.packSize === null ? null : `1 ${packName(unit)} = ${num(item.packSize)} ${BASE_LABEL[unit]}`,
        price: item.price,
      };
    }),
  };
}

/** Qator summasi (so'm, butun) — web'dagi kirim jadvali bilan bir xil yaxlitlanadi. */
const lineSum = (line: PurchaseNoticeLine) => Math.round(line.qty * (line.price ?? 0));

/**
 * "Yangi kirim" xabari (oddiy matn, tizim xabari — AI yozmaydi):
 * ```
 * 📦 Yangi kirim №15
 * Ombor: Markaziy ombor
 * Kiritdi: Ali Valiyev · 08.11.2026 14:32
 *
 * • Kartoshka — 20 kg
 *    1 kg narxi: 5 000 so'm · jami: 100 000 so'm
 * • Ketchup — 10 dona (1 dona = 600 g)
 *    1 dona narxi: 16 800 so'm · jami: 168 000 so'm
 *
 * Kirim summasi: 268 000 so'm
 * Izoh: Haftalik kirim
 * ```
 */
export function purchaseNoticeText(notice: PurchaseNotice): string {
  const lines = notice.lines.flatMap((line) => [
    `• ${line.name} — ${num(line.qty)} ${line.unit}${line.pack ? ` (${line.pack})` : ''}`,
    line.price === null
      ? '   narxi kiritilmagan'
      : `   1 ${line.unit} narxi: ${som(line.price)} · jami: ${som(lineSum(line))}`,
  ]);
  const total = Math.round(notice.lines.reduce((sum, line) => sum + line.qty * (line.price ?? 0), 0));
  return [
    `📦 Yangi kirim №${notice.number}`,
    `Ombor: ${notice.warehouseName}`,
    `Kiritdi: ${notice.authorName} · ${dateTime(notice.createdAt)}`,
    '',
    ...lines,
    '',
    `Kirim summasi: ${som(total)}`,
    ...(notice.note ? [`Izoh: ${notice.note}`] : []),
  ].join('\n');
}
