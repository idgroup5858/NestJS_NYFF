import type { EntityManager } from 'typeorm';
import type { StockUnit } from '../common/enums';
import type { LocalizedText } from '../common/types';
import { stockText } from '../domain/stock-text';
import type { LowStockCrossing } from '../warehouse/low-stock-events';

/** Filial omborida chegaradan kam qolgan mahsulot (miqdorlar — asosiy birlikda). */
export interface LowStockLine {
  name: string;
  qty: number;
  minQty: number;
  unit: StockUnit;
  packSize: number | null;
}

/** Filial bo'yicha guruh: filialning hozirgi nomi va kam qolganlari (nomi bo'yicha). */
export interface BranchLowStock {
  branchId: string;
  branchName: string;
  lines: LowStockLine[];
}

interface Row {
  branchId: string;
  branchName: string;
  name: LocalizedText;
  unit: StockUnit;
  packSize: number | null;
  qty: number;
  minQty: number;
}

/**
 * Faqat **filial** omborlari (markaziy — yo'q, foydalanuvchi qarori), faol mahsulotlar, hozir `qty < minQty`.
 * [where] — qo'shimcha shart (`$1`, `$2` — [params]).
 */
async function query(em: EntityManager, where: string, params: unknown[]): Promise<BranchLowStock[]> {
  const rows = await em.query<Row[]>(
    `SELECT w."branchId", b.name AS "branchName", i.name, i.unit, i."packSize", s.qty, s."minQty"
     FROM stock s
     JOIN warehouses w ON w.id = s."warehouseId" AND w.kind = 'branch'
     JOIN branches b ON b.id = w."branchId"
     JOIN ingredients i ON i.id = s."ingredientId" AND i.active
     WHERE s."minQty" > 0 AND s.qty < s."minQty" AND ${where}
     ORDER BY b.name, b.id, i.name->>'uz', i.id`,
    params,
  );
  const groups = new Map<string, BranchLowStock>();
  for (const row of rows) {
    const group = groups.get(row.branchId) ?? { branchId: row.branchId, branchName: row.branchName, lines: [] };
    group.lines.push({
      name: row.name.uz || row.name.ru || row.name.en,
      qty: row.qty,
      minQty: row.minQty,
      unit: row.unit,
      packSize: row.packSize,
    });
    groups.set(row.branchId, group);
  }
  return [...groups.values()];
}

/** Filial omboridagi hozir kam qolganlarning hammasi — smena hisobotiga. */
export async function loadBranchLowStock(em: EntityManager, branchId: string): Promise<LowStockLine[]> {
  return (await query(em, 'w."branchId" = $1', [branchId]))[0]?.lines ?? [];
}

/**
 * Chegaradan hozirgina tushganlar — darhol xabarga. Qoldiq yangidan o'qiladi (voqea tranzaksiya tugagach keladi): orada
 * to'ldirilgan bo'lsa — chiqmaydi, bir nechta o'zgarish bo'lsa — oxirgi qoldiq.
 */
export async function loadCrossedLowStock(em: EntityManager, crossings: LowStockCrossing[]): Promise<BranchLowStock[]> {
  return query(em, `(s."warehouseId", s."ingredientId") IN (SELECT * FROM unnest($1::varchar[], $2::varchar[]))`, [
    crossings.map((c) => c.warehouseId),
    crossings.map((c) => c.ingredientId),
  ]);
}

/** "Ketchup — 2 dona + 300 g (chegara: 3 dona)"; qoldiq 0 yoki manfiy — "tugadi". */
export function lowStockLine(line: LowStockLine): string {
  const left = line.qty > 0 ? stockText(line.qty, line.unit, line.packSize) : 'tugadi';
  return `${line.name} — ${left} (chegara: ${stockText(line.minQty, line.unit, line.packSize)})`;
}

/**
 * Darhol xabar (oddiy matn, adabiy — tizim xabari, AI yozmaydi):
 * ```
 * ⚠️ Luchvoy filialida kam qolgan mahsulotlar:
 *   • Ketchup — 2 dona + 300 g (chegara: 3 dona)
 * ```
 */
export function lowStockAlertText(group: BranchLowStock): string {
  return [
    `⚠️ ${group.branchName} filialida kam qolgan mahsulotlar:`,
    ...group.lines.map((line) => `  • ${lowStockLine(line)}`),
  ].join('\n');
}
