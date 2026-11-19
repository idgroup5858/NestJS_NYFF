import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import type { Branch } from '../branches/branch.entity';
import { Warehouse } from '../branches/warehouse.entity';
import type { MovementKind } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { unitSize } from '../domain/units';
import { rawQty } from '../domain/yield-norm';
import { Product } from '../menu/product.entity';
import type { Ingredient } from './ingredient.entity';
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

/**
 * Taomlar retsepti bo'yicha kerak bo'ladigan mahsulotlar (asosiy birlikda). [sign] = -1 — sotuv uchun chiqim.
 * [cookYields] — "pishganda chiqishi" yozilgan mahsulotlar (id → 1000 g dan necha g): retseptdagi son pishgan miqdor,
 * ombordan xomi ayriladi — 1 porsiyaga yaxlitlanib, keyin soniga ko'paytiriladi (100 g → 153 g, 2 ta — 306 g).
 */
export function recipeDeltas(
  products: Map<string, Product>,
  items: { productId: string; qty: number }[],
  sign: 1 | -1,
  cookYields: Map<string, number> = new Map(),
): StockDelta[] {
  const deltas: StockDelta[] = [];
  for (const item of items) {
    const product = products.get(item.productId);
    if (!product) continue;
    for (const line of product.recipe) {
      const qty = rawQty(line.qty, cookYields.get(line.ingredientId));
      deltas.push({ ingredientId: line.ingredientId, qty: sign * qty * item.qty });
    }
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
   * bo'ladi — xabar bir marta. Qoldiqni tuzatish (`adjust`: 0 ga tushirish, qo'lda yozish) — xabarsiz: butun ombor 0
   * qilinganda o'nlab "kam qoldi" ketmasin, qo'lda yozilganini esa yozgan odam ko'rib turibdi. [lowStockAlert] `false`
   * — boshqa turdagi harakat ham xabarsiz (filial ombori markazga qo'shilganda — `mergeIntoCentral`). [costs] —
   * harakat qiymati mahsulot bo'yicha (faqat "Sarflandi").
   */
  async applyDeltas(
    em: EntityManager,
    warehouseId: string,
    deltas: StockDelta[],
    kind: MovementKind,
    refId: string,
    at: Date,
    lowStockAlert = kind !== 'adjust',
    costs?: Map<string, number | null>,
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
    if (lowStockAlert) {
      this.lowStock.add(
        em,
        rows
          .filter((row) => crossedBelowMin(row.qty - merged.get(row.ingredientId)!, row.qty, row.minQty))
          .map((row) => ({ warehouseId, ingredientId: row.ingredientId })),
      );
    }
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
        cost: costs?.get(ingredientId) ?? null,
      })),
    );
  }

  /**
   * Sarf materiali (`Ingredient.consumable`, 2026-11-18): omborga yangi partiya kelayapti (kirim, ko'chirish) — undagi
   * eski **musbat** qoldiq sarflangan hisoblanadi va 0 ga tushadi: "Sarflandi" harakati (`consume`), `refId` — o'sha
   * kirim / ko'chirish, `cost` — qoldiq × oxirgi narx (narxsiz — `null`). Yangi partiya qo'shilishidan **oldin** chaqiriladi;
   * [ingredients] — kirim narxi yozilishidan oldin o'qilgan (eski partiya eski narxda). 0 / minus qoldiq — tegilmaydi.
   * "Kam qoldi" xabari ketmaydi. Qatorlar qulflanadi — shu paytdagi sotuv kutib turadi.
   */
  async writeOffConsumables(
    em: EntityManager,
    warehouseId: string,
    ingredients: Ingredient[],
    refId: string,
    at: Date,
  ): Promise<void> {
    const consumables = new Map(ingredients.filter((i) => i.consumable).map((i) => [i.id, i]));
    if (consumables.size === 0) return;
    const current = await this.lockQty(em, warehouseId, [...consumables.keys()]);
    const deltas: StockDelta[] = [];
    const costs = new Map<string, number | null>();
    for (const [ingredientId, qty] of current) {
      if (qty <= 0) continue;
      const ingredient = consumables.get(ingredientId)!;
      deltas.push({ ingredientId, qty: -qty });
      costs.set(
        ingredientId,
        ingredient.lastPrice === null
          ? null
          : Math.round((qty * ingredient.lastPrice) / unitSize(ingredient.unit, ingredient.packSize)),
      );
    }
    await this.applyDeltas(em, warehouseId, deltas, 'consume', refId, at, false, costs);
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
   * Filial sotuvi qaysi ombordan ayriladi: odatda filialning o'z omboridan; filialda `stockFromCentral` yoqilgan bo'lsa
   * (markazga juda yaqin filial, 2026-11-17) — markaziy ombordan. Holat sotuv paytida o'qiladi (offline sotuv — markazga
   * yetib kelgan paytdagi holat bilan).
   *
   * Filial qatori `FOR KEY SHARE` bilan o'qiladi: switch yoqilayotganda (`BranchesService.setStockFromCentral` — `FOR
   * UPDATE`, filial qoldig'i markazga qo'shiladi) shu paytdagi sotuv kutadi va yangi holat bilan markazdan ayriladi —
   * qo'shilib bo'lgan filial omboridan emas. Sotuvlar bir-birini, `hrSeenAt` kabi oddiy yangilanishlar sotuvni kutmaydi.
   */
  async saleWarehouse(em: EntityManager, branchId: string): Promise<Warehouse> {
    const [branch]: Pick<Branch, 'stockFromCentral'>[] = await em.query(
      `SELECT "stockFromCentral" FROM branches WHERE id = $1 FOR KEY SHARE`,
      [branchId],
    );
    if (!branch?.stockFromCentral) return this.branchWarehouse(em, branchId);
    return (await em.findOneBy(Warehouse, { kind: 'central' })) ?? fail('not_found', 'central warehouse');
  }

  /**
   * To'langan buyurtma oshxonaga ketdi: retsept bo'yicha mahsulotlar filial omboridan (filialda `stockFromCentral`
   * yoqilgan bo'lsa — markaziy ombordan) ayriladi. [products] — taomlar allaqachon o'qilgan bo'lsa; berilmasa bazadan
   * (menyudan o'chirilgan taom hisobga olinmaydi). "Pishganda chiqishi" yozilgan mahsulot — xomi (2026-11-19).
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
    const ingredientIds = order.items.flatMap((item) => recipes.get(item.productId)?.recipe ?? []).map((l) => l.ingredientId);
    const cookYields = await this.cookYields(em, ingredientIds);
    const warehouse = await this.saleWarehouse(em, order.branchId);
    await this.applyDeltas(em, warehouse.id, recipeDeltas(recipes, order.items, -1, cookYields), 'sale', order.id, at);
  }

  /** "Pishganda chiqishi" yozilgan mahsulotlar [ingredientIds] orasidan: id → 1000 g xomdan necha g pishgan. */
  private async cookYields(em: EntityManager, ingredientIds: string[]): Promise<Map<string, number>> {
    const ids = [...new Set(ingredientIds)];
    if (ids.length === 0) return new Map();
    const rows: { id: string; cookYield: number }[] = await em.query(
      `SELECT id, "cookYield" FROM ingredients WHERE id = ANY($1) AND "cookYield" IS NOT NULL`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row.cookYield]));
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
