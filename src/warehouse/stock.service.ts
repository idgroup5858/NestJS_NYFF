import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Warehouse } from '../branches/warehouse.entity';
import type { MovementKind } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { Product } from '../menu/product.entity';
import { LowStockEvents } from './low-stock-events';
import { StockMovement } from './stock-movement.entity';

/** Qoldiq o'zgarishi, asosiy birlikda: musbat — kirim, manfiy — chiqim. */
export interface StockDelta {
  ingredientId: string;
  qty: number;
}

/** Bir xil mahsulot o'zgarishlarini qo'shib, nollarini tashlaydi; id bo'yicha tartiblangan (qulflar bir xil tartibda). */
export function mergeDeltas(deltas: StockDelta[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const delta of deltas) merged.set(delta.ingredientId, (merged.get(delta.ingredientId) ?? 0) + delta.qty);
  return new Map([...merged].filter(([, qty]) => qty !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Taomlar retsepti bo'yicha kerak bo'ladigan mahsulotlar (asosiy birlikda). [sign] = -1 — sotuv uchun chiqim. */
export function recipeDeltas(
  products: Map<string, Product>,
  items: { productId: string; qty: number }[],
  sign: 1 | -1,
): StockDelta[] {
  const deltas: StockDelta[] = [];
  for (const item of items) {
    const product = products.get(item.productId);
    if (!product) continue;
    for (const line of product.recipe) deltas.push({ ingredientId: line.ingredientId, qty: sign * line.qty * item.qty });
  }
  return deltas;
}

/** Qoldiq chegaradan pastga tushdimi: avval chegaradan kam emas edi, endi kam (chegara qo'yilmagan — kuzatilmaydi). */
export function crossedBelowMin(before: number, after: number, minQty: number): boolean {
  return minQty > 0 && before >= minQty && after < minQty;
}

@Injectable()
export class StockService {
  constructor(private readonly lowStock: LowStockEvents) {}

  /**
   * Omborga o'zgarishlarni qo'llaydi va har bir mahsulot uchun harakat yozadi. Qoldiq manfiyga tushishi mumkin (savdo
   * to'xtamaydi). Bitta SQL bilan qo'shiladi (`qty = qty + delta`) — bir vaqtdagi buyurtmalar bir-birini o'chirmaydi.
   * Qoldig'i shu o'zgarish bilan chegaradan pastga tushgan mahsulotlar — `LowStockEvents` ga (tranzaksiya tugagach
   * Telegram'ga): qator qulflangan holda yangilanadi, shuning uchun bir vaqtdagi sotuvlardan faqat bittasi "tushirgan"
   * bo'ladi — xabar bir marta.
   */
  async applyDeltas(
    em: EntityManager,
    warehouseId: string,
    deltas: StockDelta[],
    kind: MovementKind,
    refId: string,
    at: Date,
  ): Promise<void> {
    const merged = mergeDeltas(deltas);
    if (merged.size === 0) return;
    const ids = [...merged.keys()];
    const qtys = [...merged.values()];
    const rows: { ingredientId: string; qty: number; minQty: number }[] = await em.query(
      `INSERT INTO stock ("warehouseId", "ingredientId", "qty", "minQty")
       SELECT $1, u.id, u.qty, 0 FROM unnest($2::varchar[], $3::int[]) AS u(id, qty)
       ON CONFLICT ("warehouseId", "ingredientId") DO UPDATE SET "qty" = stock."qty" + EXCLUDED."qty"
       RETURNING "ingredientId", "qty", "minQty"`,
      [warehouseId, ids, qtys],
    );
    this.lowStock.add(
      em,
      rows
        .filter((row) => crossedBelowMin(row.qty - merged.get(row.ingredientId)!, row.qty, row.minQty))
        .map((row) => ({ warehouseId, ingredientId: row.ingredientId })),
    );
    await em.insert(
      StockMovement,
      ids.map((ingredientId, index) => ({
        id: newId('mov'),
        warehouseId,
        ingredientId,
        qty: qtys[index],
        kind,
        refId,
        createdAt: at,
      })),
    );
  }

  /** Qoldiqlar (asosiy birlikda), qatorlar tranzaksiya oxirigacha qulflanadi — tekshiruvdan keyin o'zgarib qolmasin. */
  async lockQty(em: EntityManager, warehouseId: string, ingredientIds: string[]): Promise<Map<string, number>> {
    const rows: { ingredientId: string; qty: number }[] = await em.query(
      `SELECT "ingredientId", "qty" FROM stock WHERE "warehouseId" = $1 AND "ingredientId" = ANY($2)
       ORDER BY "ingredientId" FOR UPDATE`,
      [warehouseId, [...ingredientIds].sort()],
    );
    return new Map(rows.map((row) => [row.ingredientId, row.qty]));
  }

  async branchWarehouse(em: EntityManager, branchId: string): Promise<Warehouse> {
    return (
      (await em.findOneBy(Warehouse, { kind: 'branch', branchId })) ?? fail('not_found', `warehouse of ${branchId}`)
    );
  }

  /**
   * To'langan buyurtma oshxonaga ketdi: retsept bo'yicha mahsulotlar filial omboridan ayriladi. [products] — taomlar
   * allaqachon o'qilgan bo'lsa; berilmasa bazadan (menyudan o'chirilgan taom hisobga olinmaydi).
   */
  async deductOrder(
    em: EntityManager,
    order: { id: string; branchId: string; items: { productId: string; qty: number }[] },
    at: Date,
    products?: Map<string, Product>,
  ): Promise<void> {
    const recipes =
      products ??
      new Map(
        (await em.findBy(Product, { id: In([...new Set(order.items.map((item) => item.productId))]) })).map(
          (product) => [product.id, product],
        ),
      );
    const warehouse = await this.branchWarehouse(em, order.branchId);
    await this.applyDeltas(em, warehouse.id, recipeDeltas(recipes, order.items, -1), 'sale', order.id, at);
  }

  /** Bekor qilingan buyurtma: sotuvda ayrilganlar (harakatlar bo'yicha) aynan qaytadi — retsept keyin o'zgargan bo'lsa ham. */
  async returnOrder(em: EntityManager, orderId: string, at: Date): Promise<void> {
    const sales = await em.findBy(StockMovement, { refId: orderId, kind: 'sale' });
    const byWarehouse = new Map<string, StockDelta[]>();
    for (const m of sales) {
      byWarehouse.set(m.warehouseId, [...(byWarehouse.get(m.warehouseId) ?? []), { ingredientId: m.ingredientId, qty: -m.qty }]);
    }
    for (const [warehouseId, deltas] of byWarehouse) {
      await this.applyDeltas(em, warehouseId, deltas, 'sale_cancel', orderId, at);
    }
  }
}
