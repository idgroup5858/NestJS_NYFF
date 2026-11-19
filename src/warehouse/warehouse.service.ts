import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { Warehouse } from '../branches/warehouse.entity';
import type { Role, StockUnit } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { assertUnused } from '../common/in-use';
import { pageParams, type Page } from '../common/pagination';
import type { LocalizedText, ProductionItem, PurchaseItem, RecipeLine, TransferItem } from '../common/types';
import { nextCounter } from '../database/counters';
import { producedUnitPrice, productionCost } from '../domain/production';
import { convertPrice, fromBase, sameScale, toBase, unitSize } from '../domain/units';
import { normOutputPrice, normSplit, type YieldNorm } from '../domain/yield-norm';
import { Ingredient } from './ingredient.entity';
import { Production } from './production.entity';
import { PurchaseEvents } from './purchase-events';
import { Purchase } from './purchase.entity';
import { StockAdjustment } from './stock-adjustment.entity';
import { StockItem } from './stock-item.entity';
import { StockMovement } from './stock-movement.entity';
import { mergeDeltas, StockService, type StockDelta } from './stock.service';
import { Transfer } from './transfer.entity';
import {
  CreateIngredientDto,
  CreateProductionDto,
  CreatePurchaseDto,
  CreateTransferDto,
  MovementsQuery,
  ProductionsQuery,
  PurchasesQuery,
  TransfersQuery,
  UpdateIngredientDto,
} from './warehouse.dto';

export type MovementWithRef = StockMovement & {
  refNumber: number | null;
  refWarehouseId: string | null;
  /** kirim / ko'chirish / tuzatish / tayyorlashni kim yozgan (xodim id'si); buyurtmada — `null` */
  refBy: string | null;
};

/**
 * Qoldiqni tuzatish (0 ga tushirish yoki qo'lda yozish) natijasi: hujjat (o'zgarish yo'q edi — `null`, hech narsa
 * yozilmadi) va nechta mahsulot qoldig'i o'zgardi.
 */
export interface StockReset {
  adjustment: StockAdjustment | null;
  count: number;
}

/**
 * Filial ombori markazga qo'shilgani (`mergeIntoCentral`): minuslar 0 ga — "Tuzatish №N" (`zeroed` ta mahsulot), plusdagilar
 * markaziy omborga — "Ko'chirish №N" (`moved` ta); qaysi biri bo'lmasa — o'sha hujjat `null`.
 */
export interface StockMerge {
  adjustment: StockAdjustment | null;
  transfer: Transfer | null;
  zeroed: number;
  moved: number;
}

/** Ombor mahsuloti qayerlarda ishlatilgan — birlikni o'zgartirishdan oldingi ogohlantirish uchun. */
export interface IngredientUsage {
  /** retseptida shu mahsulot bor taomlar; [qty] — 1 porsiyaga, asosiy birlikda (g / ml / dona) */
  products: { id: string; name: LocalizedText; qty: number }[];
  /** qoldig'i yoki ogohlantirish chegarasi bor omborlar (asosiy birlikda) */
  stock: { warehouseId: string; qty: number; minQty: number }[];
  purchases: number;
  /** tasdiq kutayotgan eski kirimlar (2026-11-08 gacha yozilgan) */
  pendingPurchases: number;
  transfers: number;
  /** tayyorlashlar — shu mahsulot tayyorlangan yoki sarflangan */
  productions: number;
}

/** Qadoq hajmining yuqori chegarasi (asosiy birlikda): 1 dona = 1 t / 1000 l / 1 mln dona. */
const MAX_PACK_SIZE = 1_000_000;

/** Normadagi chiqishlar soni chegarasi. */
const MAX_NORM_OUTPUTS = 10;

/** Pishganda chiqishi 1000 g dan: 1…10 000 g (guruch kabi og'irlashadigani ham). */
const MAX_COOK_YIELD = 10_000;

/** SQL sharti: shu mahsulot (`$1`) boshqa mahsulot normasida chiqish sifatida bor. */
const IN_NORM = `"yieldNorm" -> 'outputs' @> jsonb_build_array(jsonb_build_object('ingredientId', $1::text))`;

/** Ikki norma bir xilmi (jsonb kalit tartibini o'zgartiradi — matn bilan solishtirib bo'lmaydi). */
function sameNorm(a: YieldNorm | null, b: YieldNorm | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.qty === b.qty &&
    a.outputs.length === b.outputs.length &&
    a.outputs.every((o, i) => o.ingredientId === b.outputs[i].ingredientId && o.qty === b.outputs[i].qty)
  );
}

/** Qo'lda yoziladigan qoldiqning yuqori chegarasi (asosiy birlikda): 1000 t / 1 mln l / 1 mlrd dona — `int` ustunga sig'adi. */
const MAX_STOCK_QTY = 1_000_000_000;

/** SQL sharti: `jsonb` ro'yxatda (retsept, hujjat qatorlari) shu mahsulot bor — `$1` — mahsulot id'si. */
const containsIngredient = (column: string) =>
  `${column} @> jsonb_build_array(jsonb_build_object('ingredientId', $1::text))`;

@Injectable()
export class WarehouseService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stock: StockService,
    private readonly purchaseEvents: PurchaseEvents,
  ) {}

  // ───────────────────────── Omborlar, mahsulotlar, qoldiq ─────────────────────────

  warehouses() {
    return this.dataSource.manager.find(Warehouse, { order: { kind: 'DESC', name: 'ASC' } });
  }

  ingredients() {
    return this.dataSource.manager.find(Ingredient, { order: { group: 'ASC', id: 'ASC' } });
  }

  /**
   * Ombor mahsuloti. Narxni ([lastPrice]) admin ham, ta'minotchi ham kiritadi (2026-11-15; avval faqat admin); har
   * kirimda u kirim narxiga yangilanadi. Qadoq hajmi ([packSize]) o'zgarib, narx yuborilmagan bo'lsa — eski narx yangi
   * birlikka qayta hisoblanadi (28 000 / kg → 600 g lik qadoq — 16 800 / dona); yuborilgan narx — yangi birlikda.
   *
   * Birlik ([unit]) tahrirda — faqat admin (2026-11-08). Qoldiq, chegara, retseptlar, qadoq hajmi va hujjatlardagi
   * sonlar o'zgarmaydi (foydalanuvchi tanladi) — web avval ogohlantirib, qayerlarni qayta tekshirishni ko'rsatadi
   * ([ingredientUsage]). kg / l ↔ dona: narx yuborilmasa bo'shatiladi (28 000 / kg dan "28 / dona" — ma'nosiz); tasdiq
   * kutayotgan eski kirimda bo'lsa — `pending_purchase` (tasdiqlanganda miqdor yangi birlikda hisoblanib, omborga
   * noto'g'ri son qo'shilardi: 12,5 kg → 13 dona). kg ↔ l — ikkalasi ×1000, sonlar to'g'ri qoladi: faqat birlik almashadi.
   *
   * Norma ([yieldNorm]) va pishganda chiqishi ([cookYield]) — faqat admin (2026-11-19; ta'minotchi o'sha qiymatni
   * yuborsa — mumkin, boshqasini — `forbidden`): ular kirim va sotuvda ombordan qancha qo'shilishi / ayrilishini
   * belgilaydi. Birlik kg / l ↔ dona o'zgarsa — ikkalasi o'chadi (norma chiqishlari boshqa o'lchamda qoladi, dona
   * "pishmaydi"); mahsulot boshqa mahsulot normasida bo'lsa, bunday o'zgarish — `invalid_input`.
   */
  async saveIngredient(
    input: (CreateIngredientDto | UpdateIngredientDto) & { id?: string },
    actorRole: Role,
  ): Promise<Ingredient> {
    const name = { uz: input.name.uz.trim(), ru: input.name.ru.trim(), en: input.name.en.trim() };
    if (!name.uz) fail('name_required');
    const lastPrice = input.lastPrice;
    if (lastPrice != null && (!Number.isInteger(lastPrice) || lastPrice < 0)) fail('invalid_price');
    const packSize = input.packSize;
    if (packSize != null && (!Number.isInteger(packSize) || packSize < 1 || packSize > MAX_PACK_SIZE)) {
      fail('invalid_qty', 'packSize');
    }
    const cookYield = input.cookYield;
    if (cookYield != null && (!Number.isInteger(cookYield) || cookYield < 1 || cookYield > MAX_COOK_YIELD)) {
      fail('invalid_qty', 'cookYield');
    }
    /** berilmagan — `undefined` (o'zgarmaydi); ortiqcha maydonlarsiz nusxa */
    const norm: YieldNorm | null | undefined =
      input.yieldNorm == null
        ? input.yieldNorm
        : {
            qty: input.yieldNorm.qty,
            outputs: input.yieldNorm.outputs.map((o) => ({ ingredientId: o.ingredientId, qty: o.qty })),
          };
    const adminOnly = (field: string) => {
      if (actorRole !== 'admin') fail('forbidden', field);
    };
    const id = input.id;
    if (id) {
      return this.dataSource.transaction(async (em) => {
        const current = await this.getIngredient(em, id, true);
        const unit = input.unit ?? current.unit;
        const reunit = unit !== current.unit;
        const rescale = !sameScale(current.unit, unit);
        if (reunit && actorRole !== 'admin') fail('forbidden', 'unit');
        if (rescale) {
          const pending: unknown[] = await em.query(
            `SELECT 1 FROM purchases WHERE status = 'pending' AND ${containsIngredient('items')} LIMIT 1`,
            [id],
          );
          if (pending.length > 0) fail('pending_purchase');
          const inNorm: unknown[] = await em.query(`SELECT 1 FROM ingredients WHERE ${IN_NORM} LIMIT 1`, [id]);
          if (inNorm.length > 0) fail('invalid_input', 'yieldNorm');
        }

        let nextCook = cookYield;
        if (nextCook !== undefined && nextCook !== current.cookYield) adminOnly('cookYield');
        if (unit === 'pcs') {
          if (nextCook != null) fail('invalid_input', 'cookYield');
          if (nextCook === undefined && current.cookYield !== null) nextCook = null;
        }
        let nextNorm = norm;
        const renorm = nextNorm !== undefined && !sameNorm(nextNorm, current.yieldNorm);
        if (renorm) adminOnly('yieldNorm');
        if (renorm && nextNorm) await this.checkNorm(em, id, unit, nextNorm);
        if (nextNorm === undefined && rescale && current.yieldNorm !== null) nextNorm = null;
        const repack = packSize !== undefined && packSize !== current.packSize;
        let repriced = lastPrice;
        if (lastPrice === undefined && current.lastPrice !== null) {
          if (rescale) repriced = null;
          else if (repack) {
            repriced = convertPrice(current.lastPrice, unitSize(current.unit, current.packSize), unitSize(unit, packSize));
          }
        }
        await em.update(Ingredient, id, {
          name,
          group: input.group,
          active: input.active,
          ...(input.consumable !== undefined && { consumable: input.consumable }),
          ...(reunit && { unit }),
          ...(repack && { packSize }),
          ...(repriced !== undefined && { lastPrice: repriced }),
          ...(nextNorm !== undefined && { yieldNorm: nextNorm }),
          ...(nextCook !== undefined && { cookYield: nextCook }),
        });
        return this.getIngredient(em, id);
      });
    }
    const unit = input.unit ?? fail('invalid_input', 'unit');
    if (cookYield != null) {
      adminOnly('cookYield');
      if (unit === 'pcs') fail('invalid_input', 'cookYield');
    }
    if (norm) {
      adminOnly('yieldNorm');
      await this.checkNorm(this.dataSource.manager, null, unit, norm);
    }
    const ingredient: Ingredient = {
      id: newId('ing'),
      name,
      group: input.group,
      unit,
      packSize: packSize ?? null,
      lastPrice: lastPrice ?? null,
      consumable: input.consumable ?? false,
      yieldNorm: norm ?? null,
      cookYield: cookYield ?? null,
      active: input.active,
    };
    await this.dataSource.manager.insert(Ingredient, ingredient);
    return ingredient;
  }

  /**
   * Norma to'g'rimi: namuna > 0; chiqishlar 1…10 ta, takrorsiz, mahsulotning o'zi emas (`invalid_input`), har biri > 0,
   * jami namunadan ko'p emas (`invalid_qty`). Chiqqanlar butun mahsulot bilan bir o'lchamda — kg / l yoki dona (narx
   * og'irligi bo'yicha bo'linadi) va o'zlarining normasi yo'q; mahsulotning o'zi boshqa normada chiqish bo'lmaydi
   * (zanjir yo'q — kirimda bir marta bo'linadi). Aks holda `invalid_input`. [selfId] — yangi mahsulotda `null`.
   */
  private async checkNorm(em: EntityManager, selfId: string | null, unit: StockUnit, norm: YieldNorm): Promise<void> {
    const sample = toBase(norm.qty, unit);
    if (!(norm.qty > 0) || sample < 1 || sample > MAX_STOCK_QTY) fail('invalid_qty', 'yieldNorm');
    const ids = norm.outputs.map((output) => output.ingredientId);
    if (
      ids.length === 0 ||
      ids.length > MAX_NORM_OUTPUTS ||
      new Set(ids).size !== ids.length ||
      (selfId !== null && ids.includes(selfId))
    ) {
      fail('invalid_input', 'yieldNorm');
    }
    const outputs = await this.ingredientMap(em, ids);
    let total = 0;
    for (const output of norm.outputs) {
      const ingredient = outputs.get(output.ingredientId) ?? fail('not_found', `ingredient ${output.ingredientId}`);
      if (!sameScale(ingredient.unit, unit) || ingredient.yieldNorm !== null) fail('invalid_input', 'yieldNorm');
      const base = toBase(output.qty, ingredient.unit);
      if (!(output.qty > 0) || base < 1) fail('invalid_qty', 'yieldNorm');
      total += base;
    }
    if (total > sample) fail('invalid_qty', 'yieldNorm');
    if (selfId !== null) {
      const inNorm: unknown[] = await em.query(`SELECT 1 FROM ingredients WHERE ${IN_NORM} LIMIT 1`, [selfId]);
      if (inNorm.length > 0) fail('invalid_input', 'yieldNorm');
    }
  }

  /**
   * Ombor mahsulotini o'chirish — hech qayerda ishlatilmagan bo'lsa: taom retseptida, boshqa mahsulot normasida,
   * kirimda, ko'chirishda, tayyorlashda, qoldiq harakatida, chiqimda yo'q. Aks holda `in_use` — faolsizlantirish kerak. Qoldiq yozuvlari
   * (harakatsiz — 0) u bilan o'chadi.
   */
  async removeIngredient(id: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await this.getIngredient(em, id);
      await assertUnused(em, id, {
        recipes: `SELECT 1 FROM products WHERE ${containsIngredient('recipe')} LIMIT 1`,
        // boshqa mahsulot normasida chiqish (normaning o'zi mahsulot bilan o'chadi)
        norms: `SELECT 1 FROM ingredients WHERE ${IN_NORM} LIMIT 1`,
        purchases: `SELECT 1 FROM purchases WHERE ${containsIngredient('items')} LIMIT 1`,
        transfers: `SELECT 1 FROM transfers WHERE ${containsIngredient('items')} LIMIT 1`,
        productions: `SELECT 1 FROM productions WHERE "ingredientId" = $1::text OR ${containsIngredient('items')} LIMIT 1`,
        movements: `SELECT 1 FROM stock_movements WHERE "ingredientId" = $1 LIMIT 1`,
        expenses: `SELECT 1 FROM expenses WHERE "ingredientId" = $1 LIMIT 1`,
      });
      await em.delete(StockItem, { ingredientId: id });
      await em.delete(Ingredient, { id });
    });
  }

  /**
   * Birlikni o'zgartirishdan oldin (web ogohlantirish oynasi): sonlari eski birlikda turgan joylar — retseptida bor
   * taomlar (1 porsiyaga, asosiy birlikda), qoldig'i yoki chegarasi bor omborlar, kirim, ko'chirish va tayyorlashlar
   * soni, tasdiq kutayotgan eski kirimlar (ular bo'lsa kg / l ↔ dona — `pending_purchase`).
   */
  async ingredientUsage(id: string): Promise<IngredientUsage> {
    const em = this.dataSource.manager;
    await this.getIngredient(em, id);
    const [products, stock, [counts]] = await Promise.all([
      em.query<{ id: string; name: LocalizedText; recipe: RecipeLine[] }[]>(
        `SELECT id, name, recipe FROM products WHERE ${containsIngredient('recipe')} ORDER BY name->>'uz', id`,
        [id],
      ),
      em.query<IngredientUsage['stock']>(
        `SELECT "warehouseId", qty, "minQty" FROM stock
         WHERE "ingredientId" = $1 AND (qty <> 0 OR "minQty" > 0) ORDER BY "warehouseId"`,
        [id],
      ),
      em.query<Record<'purchases' | 'pendingPurchases' | 'transfers' | 'productions', string>[]>(
        `SELECT (SELECT COUNT(*) FROM purchases WHERE ${containsIngredient('items')}) AS purchases,
           (SELECT COUNT(*) FROM purchases WHERE status = 'pending' AND ${containsIngredient('items')})
             AS "pendingPurchases",
           (SELECT COUNT(*) FROM transfers WHERE ${containsIngredient('items')}) AS transfers,
           (SELECT COUNT(*) FROM productions WHERE "ingredientId" = $1::text OR ${containsIngredient('items')})
             AS productions`,
        [id],
      ),
    ]);
    return {
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        qty: product.recipe.reduce((sum, line) => (line.ingredientId === id ? sum + line.qty : sum), 0),
      })),
      stock,
      purchases: Number(counts.purchases),
      pendingPurchases: Number(counts.pendingPurchases),
      transfers: Number(counts.transfers),
      productions: Number(counts.productions),
    };
  }

  stockItems(warehouseId?: string) {
    return this.dataSource.manager.find(StockItem, { where: warehouseId ? { warehouseId } : {} });
  }

  /**
   * To'ldirish kerak bo'lganlar: chegarasi qo'yilgan va qoldig'i chegaradan kam, yoki qoldig'i **minus** (chegarasiz
   * ham — qoldiq kiritilmasdan sotilgan). Chegarasiz 0 qoldiq — yo'q (ishlatilmayotgan mahsulot bo'lishi mumkin). Sarf
   * materiallari — yo'q (qoldig'i keyingi partiyagacha kamaymaydi, "kam qoldi" ma'nosiz).
   */
  lowStock(warehouseId?: string) {
    const qb = this.dataSource.manager
      .createQueryBuilder(StockItem, 's')
      .innerJoin(Ingredient, 'i', 'i.id = s.ingredientId AND NOT i.consumable')
      .where(new Brackets((w) => w.where('s.minQty > 0 AND s.qty < s.minQty').orWhere('s.qty < 0')));
    if (warehouseId) qb.andWhere('s.warehouseId = :warehouseId', { warehouseId });
    return qb.getMany();
  }

  /** Ogohlantirish chegarasi (asosiy birlikda); 0 — kuzatilmaydi. Qoldiq yozuvi bo'lmasa — 0 qoldiq bilan ochiladi. */
  async setMinQty(warehouseId: string, ingredientId: string, minQty: number): Promise<StockItem> {
    const em = this.dataSource.manager;
    await this.getWarehouse(em, warehouseId);
    await this.getIngredient(em, ingredientId);
    if (!Number.isInteger(minQty) || minQty < 0) fail('invalid_qty', ingredientId);
    const rows: StockItem[] = await em.query(
      `INSERT INTO stock ("warehouseId", "ingredientId", "qty", "minQty") VALUES ($1, $2, 0, $3)
       ON CONFLICT ("warehouseId", "ingredientId") DO UPDATE SET "minQty" = EXCLUDED."minQty"
       RETURNING "warehouseId", "ingredientId", "qty", "minQty"`,
      [warehouseId, ingredientId, minQty],
    );
    return rows[0];
  }

  /**
   * Qoldiqni 0 ga tushirish (2026-11-10, faqat admin) — hisob yuritilmagan davrdan keyin "toza boshlash": [ingredientId]
   * berilsa — bitta mahsulot, aks holda ombordagi 0 dan farqli **hamma** qoldiq (minus ham, plus ham; faolsiz mahsulot
   * ham). Har biriga teskari harakat (`adjust`) yoziladi — tarixda "Tuzatish №N", kim va qachon; chegara va norma
   * o'zgarmaydi; "kam qoldi" xabari ketmaydi. Qatorlar qulflanadi: shu paytdagi sotuv kutib turadi va 0 dan ayriladi
   * (yo'qolmaydi). Hammasi allaqachon 0 bo'lsa — hujjat yaratilmaydi.
   */
  async resetStock(
    warehouseId: string,
    ingredientId: string | undefined,
    createdBy: string,
    now = new Date(),
  ): Promise<StockReset> {
    return this.dataSource.transaction(async (em) => {
      await this.getWarehouse(em, warehouseId);
      if (ingredientId) await this.getIngredient(em, ingredientId);
      const rows: { ingredientId: string; qty: number }[] = await em.query(
        `SELECT "ingredientId", "qty" FROM stock
         WHERE "warehouseId" = $1 AND "qty" <> 0 ${ingredientId ? 'AND "ingredientId" = $2' : ''}
         ORDER BY "ingredientId" FOR UPDATE`,
        ingredientId ? [warehouseId, ingredientId] : [warehouseId],
      );
      const deltas = rows.map((row) => ({ ingredientId: row.ingredientId, qty: -row.qty }));
      return this.adjustStock(em, warehouseId, deltas, createdBy, now);
    });
  }

  /**
   * Qoldiqni qo'lda yozish (2026-11-15, admin va ta'minotchi) — sanab chiqilgan haqiqiy qoldiq: xato kirim, yo'qolgan /
   * buzilgan mahsulot. [qty] — yangi qoldiq, asosiy birlikda (g / ml / dona), butun 0…1 mlrd (`invalid_qty`).
   * To'g'ridan-to'g'ri `qty = …` emas — farqi (yangi − hozirgi) `adjust` harakati va "Tuzatish №N" hujjati bo'lib
   * yoziladi (0 ga tushirishdagidek: kim, qachon, qancha; "kam qoldi" xabari ketmaydi). Qator qulflanadi: shu paytdagi
   * sotuv kutib turadi va yangi qoldiqdan ayriladi. Hozirgisi bilan bir xil — hujjatsiz (`count` 0).
   */
  async setStockQty(
    warehouseId: string,
    ingredientId: string,
    qty: number,
    createdBy: string,
    now = new Date(),
  ): Promise<StockReset> {
    return this.dataSource.transaction(async (em) => {
      await this.getWarehouse(em, warehouseId);
      await this.getIngredient(em, ingredientId);
      if (!Number.isInteger(qty) || qty < 0 || qty > MAX_STOCK_QTY) fail('invalid_qty', ingredientId);
      const current = (await this.stock.lockQty(em, warehouseId, [ingredientId])).get(ingredientId) ?? 0;
      return this.adjustStock(em, warehouseId, [{ ingredientId, qty: qty - current }], createdBy, now);
    });
  }

  /**
   * Filial ombori markazga qo'shiladi (2026-11-17, filialda "Sotuv markaziy ombordan" yoqilganda — markazga juda yaqin
   * filial): **minus** qoldiqlar 0 ga — "Tuzatish №N" (`adjust`, markazga tegmaydi; foydalanuvchi qarori), **plus**
   * qoldiqlar markaziy omborga — "Ko'chirish №N" (filial → markaz, qatorlar ombor birligida — qadoqlida donada, kasr
   * bo'lishi mumkin). 0 dagilar, chegara va norma o'zgarmaydi; faolsiz mahsulot ham (0 ga tushirishdagidek). "Kam qoldi"
   * xabari ketmaydi. Filial qatorlari qulflanadi. [em] — chaqiruvchining tranzaksiyasi (switch bilan birga saqlanadi).
   */
  async mergeIntoCentral(
    em: EntityManager,
    warehouseId: string,
    note: string,
    createdBy: string,
    now: Date,
  ): Promise<StockMerge> {
    const central = (await em.findOneBy(Warehouse, { kind: 'central' })) ?? fail('not_found', 'central warehouse');
    const rows: { ingredientId: string; qty: number }[] = await em.query(
      `SELECT "ingredientId", "qty" FROM stock WHERE "warehouseId" = $1 AND "qty" <> 0 ORDER BY "ingredientId" FOR UPDATE`,
      [warehouseId],
    );
    const minus = rows.filter((row) => row.qty < 0);
    const plus = rows.filter((row) => row.qty > 0);

    const { adjustment } = await this.adjustStock(
      em,
      warehouseId,
      minus.map((row) => ({ ingredientId: row.ingredientId, qty: -row.qty })),
      createdBy,
      now,
    );

    let transfer: Transfer | null = null;
    if (plus.length > 0) {
      const ingredients = await this.ingredientMap(em, plus.map((row) => row.ingredientId));
      transfer = {
        id: newId('trf'),
        number: await nextCounter(em, 'transfer'),
        fromWarehouseId: warehouseId,
        toWarehouseId: central.id,
        items: plus.map((row): TransferItem => {
          const ingredient = ingredients.get(row.ingredientId) ?? fail('not_found', `ingredient ${row.ingredientId}`);
          return {
            ingredientId: row.ingredientId,
            qty: fromBase(row.qty, ingredient.unit, ingredient.packSize),
            packSize: ingredient.packSize,
          };
        }),
        note,
        createdBy,
        createdAt: now,
      };
      await em.insert(Transfer, transfer);
      const into = plus.map((row) => ({ ingredientId: row.ingredientId, qty: row.qty }));
      const out = into.map((delta) => ({ ...delta, qty: -delta.qty }));
      await this.stock.applyDeltas(em, warehouseId, out, 'transfer_out', transfer.id, now, false);
      await this.stock.applyDeltas(em, central.id, into, 'transfer_in', transfer.id, now, false);
    }
    return { adjustment, transfer, zeroed: minus.length, moved: plus.length };
  }

  /** "Tuzatish №N" hujjati va har o'zgarishga `adjust` harakati; o'zgarish yo'q (hammasi 0) — hech narsa yozilmaydi. */
  private async adjustStock(
    em: EntityManager,
    warehouseId: string,
    deltas: StockDelta[],
    createdBy: string,
    now: Date,
  ): Promise<StockReset> {
    const changes = deltas.filter((delta) => delta.qty !== 0);
    if (changes.length === 0) return { adjustment: null, count: 0 };

    const adjustment: StockAdjustment = {
      id: newId('adj'),
      number: await nextCounter(em, 'adjustment'),
      warehouseId,
      createdBy,
      createdAt: now,
    };
    await em.insert(StockAdjustment, adjustment);
    await this.stock.applyDeltas(em, warehouseId, changes, 'adjust', adjustment.id, now);
    return { adjustment, count: changes.length };
  }

  /**
   * Harakatlar (yangisi birinchi) — sabab bo'lgan hujjat raqami bilan: buyurtma, kirim, ko'chirish, tuzatish yoki
   * tayyorlash raqami (`refNumber`) va kim yozgani (`refBy`, buyurtmada — `null`); ko'chirishda — ikkinchi ombor
   * (`refWarehouseId`: kirimda qayerdan, chiqimda qayerga).
   */
  async movements(query: MovementsQuery): Promise<Page<MovementWithRef>> {
    const { page, limit, skip } = pageParams(query, 100);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: string | undefined) => {
      if (!value) return;
      params.push(value);
      where.push(`m."${column}" = $${params.length}`);
    };
    add('warehouseId', query.warehouseId);
    add('ingredientId', query.ingredientId);
    add('kind', query.kind);
    add('refId', query.refId);
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const em = this.dataSource.manager;
    const [rows, [{ count }]] = await Promise.all([
      em.query<MovementWithRef[]>(
        `SELECT m.id, m."warehouseId", m."ingredientId", m.qty, m.kind, m."refId", m."createdAt",
           m.cost::float8 AS cost,
           COALESCE(o.number, p.number, t.number, a.number, pr.number) AS "refNumber",
           CASE m.kind WHEN 'transfer_in' THEN t."fromWarehouseId" WHEN 'transfer_out' THEN t."toWarehouseId" END
             AS "refWarehouseId",
           COALESCE(p."createdBy", t."createdBy", a."createdBy", pr."createdBy") AS "refBy"
         FROM stock_movements m
         LEFT JOIN orders o ON m.kind IN ('sale', 'sale_cancel') AND o.id = m."refId"
         -- "Sarflandi" — yangi partiyani olib kelgan kirim yoki ko'chirish
         LEFT JOIN purchases p ON m.kind IN ('purchase', 'consume') AND p.id = m."refId"
         LEFT JOIN transfers t ON m.kind IN ('transfer_in', 'transfer_out', 'consume') AND t.id = m."refId"
         LEFT JOIN stock_adjustments a ON m.kind = 'adjust' AND a.id = m."refId"
         LEFT JOIN productions pr ON m.kind = 'production' AND pr.id = m."refId"
         ${filter}
         ORDER BY m."createdAt" DESC, m.id
         LIMIT ${limit} OFFSET ${skip}`,
        params,
      ),
      em.query<{ count: string }[]>(`SELECT COUNT(*) AS count FROM stock_movements m ${filter}`, params),
    ]);
    return { items: rows, total: Number(count), page, limit };
  }

  // ───────────────────────── Kirim ─────────────────────────

  async purchases(query: PurchasesQuery): Promise<Page<Purchase>> {
    const { page, limit, skip } = pageParams(query);
    const [items, total] = await this.dataSource.manager.findAndCount(Purchase, {
      where: { ...(query.status && { status: query.status }), ...(query.warehouseId && { warehouseId: query.warehouseId }) },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async purchase(id: string): Promise<Purchase> {
    return (await this.dataSource.manager.findOneBy(Purchase, { id })) ?? fail('not_found', `purchase ${id}`);
  }

  /**
   * Kirim (ta'minotchi yoki admin; 2026-11-08 dan admin tasdiqlamaydi): mahsulotlar darhol omborga qo'shiladi, kirim
   * `approved` bo'lib saqlanadi. Narxni (1 birlik / 1 dona) kirituvchi o'zi yozadi — har mahsulotning "oxirgi narxi" shunga
   * yangilanadi; yozilmasa — oxirgi narx, u ham yo'q bo'lsa `invalid_price`. Normasi bor mahsulot (butun tovuq) —
   * chiqqanlari bo'lib qo'shiladi (`receive`). Saqlangach — Telegram'ga "Yangi kirim".
   */
  async createPurchase(input: CreatePurchaseDto, createdBy: string, now = new Date()): Promise<Purchase> {
    const purchase = await this.dataSource.transaction(async (em) => {
      if (input.items.length === 0) fail('empty_order');
      await this.getWarehouse(em, input.warehouseId);
      // narx va qadoq hajmi bir vaqtda o'zgarib qolmasin — qatorlar (normadagi chiqishlar ham) qulflanadi
      const ingredients = await this.ingredientMap(
        em,
        await this.withNormOutputs(em, input.items.map((line) => line.ingredientId)),
        true,
      );
      const ingredientOf = (id: string) => ingredients.get(id) ?? fail('not_found', `ingredient ${id}`);
      const items: PurchaseItem[] = input.items.map((line) => {
        const ingredient = ingredientOf(line.ingredientId);
        if (!(line.qty > 0)) fail('invalid_qty', ingredient.id);
        const price = line.price ?? ingredient.lastPrice;
        // so'm — butun son (`lastPrice` bigint)
        if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) fail('invalid_price', ingredient.id);
        return { ingredientId: ingredient.id, qty: line.qty, price, packSize: ingredient.packSize };
      });
      // qatordagi qadoq — mahsulotning hozirgi qadog'i: narx shu birlikda
      for (const item of items) await em.update(Ingredient, item.ingredientId, { lastPrice: item.price });

      const id = newId('pur');
      const created: Purchase = {
        id,
        number: await nextCounter(em, 'purchase'),
        warehouseId: input.warehouseId,
        items: await this.receive(em, id, input.warehouseId, items, ingredients, now),
        note: input.note?.trim() ?? '',
        status: 'approved',
        createdBy,
        createdAt: now,
        decidedBy: null,
        decidedAt: null,
      };
      await em.insert(Purchase, created);
      return created;
    });
    this.purchaseEvents.created(purchase);
    return purchase;
  }

  /**
   * Kirim qatorlari omborga (yangi kirim, eski kirimni tasdiqlash). Normasi bor mahsulot (butun tovuq, 2026-11-19)
   * **o'zi qo'shilmaydi** — normadagi nisbatda chiqqanlari (go'sht, qanot) qo'shiladi va qatorga `outputs` (asosiy
   * birlikda) yoziladi; chiqqanlarning "oxirgi narxi" — kirim narxidan, og'irligi bo'yicha teng (shu kirimda o'zining
   * alohida qatori bo'lsa — o'sha qator narxi qoladi). Sarf materialining eski qoldig'i avval "Sarflandi" — [ingredients]
   * narx yozilishidan oldin o'qilgan (eski partiya eski narxda). Harakatlar — `purchase`, [purchaseId] bilan.
   * Qaytaradi — qatorlar (`outputs` bilan).
   */
  private async receive(
    em: EntityManager,
    purchaseId: string,
    warehouseId: string,
    items: PurchaseItem[],
    ingredients: Map<string, Ingredient>,
    now: Date,
  ): Promise<PurchaseItem[]> {
    const ingredientOf = (id: string) => ingredients.get(id) ?? fail('not_found', `ingredient ${id}`);
    const unitOf = (id: string) => ingredientOf(id).unit;
    const lineIds = new Set(items.map((item) => item.ingredientId));
    const deltas: StockDelta[] = [];
    const prices = new Map<string, number>();
    const received = items.map((item): PurchaseItem => {
      const ingredient = ingredientOf(item.ingredientId);
      const qty = toBase(item.qty, ingredient.unit, item.packSize);
      const norm = ingredient.yieldNorm;
      if (!norm) {
        deltas.push({ ingredientId: ingredient.id, qty });
        return item;
      }
      const outputs = normSplit(qty, norm, ingredient.unit, unitOf).filter((output) => output.qty > 0);
      deltas.push(...outputs);
      if (item.price !== null) {
        const lineSize = unitSize(ingredient.unit, item.packSize);
        for (const { ingredientId } of norm.outputs) {
          if (lineIds.has(ingredientId)) continue;
          const output = ingredientOf(ingredientId);
          const outputSize = unitSize(output.unit, output.packSize);
          prices.set(ingredientId, normOutputPrice(item.price, lineSize, norm, ingredient.unit, unitOf, outputSize));
        }
      }
      return { ...item, outputs };
    });
    for (const [ingredientId, lastPrice] of prices) await em.update(Ingredient, ingredientId, { lastPrice });
    const receiving = [...new Set(deltas.map((delta) => delta.ingredientId))].map(ingredientOf);
    await this.stock.writeOffConsumables(em, warehouseId, receiving, purchaseId, now);
    await this.stock.applyDeltas(em, warehouseId, deltas, 'purchase', purchaseId, now);
    return received;
  }

  /** [ids] va ularning normalaridagi chiqishlar — kirimda hammasi birga (bir tartibda) qulflanadi. */
  private async withNormOutputs(em: EntityManager, ids: string[]): Promise<string[]> {
    const rows = await em.find(Ingredient, { select: { id: true, yieldNorm: true }, where: { id: In(ids) } });
    return [...ids, ...rows.flatMap((row) => row.yieldNorm?.outputs.map((output) => output.ingredientId) ?? [])];
  }

  /**
   * Faqat **eski** kirim (2026-11-08 gacha yozilgan, tasdiq kutayotgan) — yangilari darhol omborga qo'shiladi.
   * Admin narxlarni kiritib tasdiqlaydi: mahsulotlar omborga qo'shiladi, har bir mahsulotning "oxirgi narxi" yangilanadi.
   * [prices] — mahsulot id → 1 birlik (qatorda qadoq bo'lsa — 1 dona) narxi; berilmaganlari kirimdagi narxida qoladi.
   * Miqdor qatordagi qadoq hajmi bilan hisoblanadi; mahsulotning qadoq hajmi kirimdan keyin o'zgargan bo'lsa, "oxirgi
   * narx" uning hozirgi birligiga o'giriladi.
   */
  async approvePurchase(id: string, prices: Record<string, number>, adminId: string, now = new Date()) {
    return this.dataSource.transaction(async (em) => {
      const purchase = await this.lockPurchase(em, id);
      if (purchase.status !== 'pending') fail('already_decided');

      const items: PurchaseItem[] = purchase.items.map((item) => {
        const price = prices[item.ingredientId] ?? item.price;
        // so'm — butun son (`lastPrice` bigint)
        if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) fail('invalid_price', item.ingredientId);
        return { ...item, price };
      });
      const ingredients = await this.ingredientMap(
        em,
        await this.withNormOutputs(em, items.map((item) => item.ingredientId)),
        true,
      );
      const ingredientOf = (item: PurchaseItem) =>
        ingredients.get(item.ingredientId) ?? fail('not_found', `ingredient ${item.ingredientId}`);
      for (const item of items) {
        const ingredient = ingredientOf(item);
        const lineSize = unitSize(ingredient.unit, item.packSize);
        const currentSize = unitSize(ingredient.unit, ingredient.packSize);
        const lastPrice = lineSize === currentSize ? item.price! : convertPrice(item.price!, lineSize, currentSize);
        await em.update(Ingredient, item.ingredientId, { lastPrice });
      }

      // normasi bor mahsulot — hozirgi norma bo'yicha (kirim yozilgan paytda norma bo'lmagan)
      const received = await this.receive(em, purchase.id, purchase.warehouseId, items, ingredients, now);
      const approved: Purchase = { ...purchase, items: received, status: 'approved', decidedBy: adminId, decidedAt: now };
      await em.update(Purchase, id, { items: received, status: 'approved', decidedBy: adminId, decidedAt: now });
      return approved;
    });
  }

  /** Faqat eski (tasdiq kutayotgan) kirim — omborga hech narsa qo'shilmaydi. */
  async rejectPurchase(id: string, adminId: string, now = new Date()): Promise<Purchase> {
    return this.dataSource.transaction(async (em) => {
      const purchase = await this.lockPurchase(em, id);
      if (purchase.status !== 'pending') fail('already_decided');
      await em.update(Purchase, id, { status: 'rejected', decidedBy: adminId, decidedAt: now });
      return { ...purchase, status: 'rejected', decidedBy: adminId, decidedAt: now };
    });
  }

  // ───────────────────────── Ko'chirish ─────────────────────────

  async transfers(query: TransfersQuery): Promise<Page<Transfer>> {
    const { page, limit, skip } = pageParams(query);
    const qb = this.dataSource.manager.createQueryBuilder(Transfer, 't').orderBy('t.createdAt', 'DESC');
    if (query.warehouseId) {
      qb.where(
        new Brackets((w) =>
          w.where('t.fromWarehouseId = :id', { id: query.warehouseId }).orWhere('t.toWarehouseId = :id'),
        ),
      );
    }
    const [items, total] = await qb.skip(skip).take(limit).getManyAndCount();
    return { items, total, page, limit };
  }

  /** Ombordan omborga ko'chirish: biridan chiqim, ikkinchisiga kirim — bitta tranzaksiyada; qoldiqdan ko'p bo'lmaydi. */
  async createTransfer(input: CreateTransferDto, createdBy: string, now = new Date()): Promise<Transfer> {
    return this.dataSource.transaction(async (em) => {
      if (input.fromWarehouseId === input.toWarehouseId) fail('same_warehouse');
      if (input.items.length === 0) fail('empty_order');
      await this.getWarehouse(em, input.fromWarehouseId);
      await this.getWarehouse(em, input.toWarehouseId);

      const ingredients = await this.ingredientMap(em, input.items.map((item) => item.ingredientId));
      const baseDeltas = input.items.map((item) => {
        const ingredient = ingredients.get(item.ingredientId) ?? fail('not_found', `ingredient ${item.ingredientId}`);
        if (!(item.qty > 0)) fail('invalid_qty', ingredient.id);
        return { ingredientId: ingredient.id, qty: toBase(item.qty, ingredient.unit, ingredient.packSize) };
      });
      // bir mahsulot ikki qatorda bo'lsa ham jami qoldiqdan oshmasin
      const needed = new Map<string, number>();
      for (const delta of baseDeltas) needed.set(delta.ingredientId, (needed.get(delta.ingredientId) ?? 0) + delta.qty);
      const available = await this.stock.lockQty(em, input.fromWarehouseId, [...needed.keys()]);
      for (const [ingredientId, qty] of needed) {
        if ((available.get(ingredientId) ?? 0) < qty) fail('insufficient_stock', ingredientId);
      }

      const transfer: Transfer = {
        id: newId('trf'),
        number: await nextCounter(em, 'transfer'),
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        items: input.items.map(
          (item): TransferItem => ({
            ingredientId: item.ingredientId,
            qty: item.qty,
            packSize: ingredients.get(item.ingredientId)!.packSize,
          }),
        ),
        note: input.note?.trim() ?? '',
        createdBy,
        createdAt: now,
      };
      await em.insert(Transfer, transfer);
      const out = baseDeltas.map((d) => ({ ...d, qty: -d.qty }));
      await this.stock.applyDeltas(em, input.fromWarehouseId, out, 'transfer_out', transfer.id, now);
      // qabul qilgan omborda sarf materialining eski qoldig'i — "Sarflandi"; jo'natgan omborda — oddiy chiqim
      await this.stock.writeOffConsumables(em, input.toWarehouseId, [...ingredients.values()], transfer.id, now);
      await this.stock.applyDeltas(em, input.toWarehouseId, baseDeltas, 'transfer_in', transfer.id, now);
      return transfer;
    });
  }

  // ───────────────────────── Tayyorlash ─────────────────────────

  /** Tayyorlashlar (yangisi birinchi); [ingredientId] — shu mahsulot tayyorlanganlari. */
  async productions(query: ProductionsQuery): Promise<Page<Production>> {
    const { page, limit, skip } = pageParams(query);
    const [items, total] = await this.dataSource.manager.findAndCount(Production, {
      where: query.ingredientId ? { ingredientId: query.ingredientId } : {},
      order: { createdAt: 'DESC', number: 'DESC' },
      skip,
      take: limit,
    });
    return { items, total, page, limit };
  }

  /**
   * Tayyorlash (2026-11-18, admin va ta'minotchi) — doim **markaziy** omborda: go'sht, tuxum, yog' → katlet. Oshpaz
   * haqiqatda qancha sarflaganini aytadi, chiqqan sonini sanab yozadi (oldindan "tarkib" yo'q — yo'qotish ham, qoldiq
   * ham aniq). Miqdorlar qadoqsiz birlikda — kg / l / dona: qadoqli tuxum ham donada.
   *
   * Bitta tranzaksiyada: sarflanganlar ombordan ayriladi (qoldiqdan ko'p bo'lmaydi — `insufficient_stock`, bir mahsulot
   * ikki qatorda bo'lsa — jami), tayyor mahsulot qo'shiladi; harakatlar — `production`, "Tayyorlash №N". Tannarx —
   * sarflanganlarning oxirgi narxidan; hammasining narxi bo'lsa, tayyor mahsulotning "oxirgi narxi" = tannarx ÷ chiqqan
   * miqdor (birortasi narxsiz — narx o'zgarmaydi). Chegaradan tushganlar `LowStockEvents` ga boradi (sotuvdagidek), lekin
   * Telegram "kam qoldi" faqat filial omborlari bo'yicha — markaziy ombor uchun xabar ketmaydi.
   */
  async createProduction(input: CreateProductionDto, createdBy: string, now = new Date()): Promise<Production> {
    return this.dataSource.transaction(async (em) => {
      if (input.items.length === 0) fail('empty_order');
      const central = (await em.findOneBy(Warehouse, { kind: 'central' })) ?? fail('not_found', 'central warehouse');
      // narx bir vaqtda o'zgarib qolmasin (kirim, mahsulot oynasi) — qatorlar qulflanadi
      const ingredients = await this.ingredientMap(
        em,
        [input.ingredientId, ...input.items.map((line) => line.ingredientId)],
        true,
      );
      const ingredientOf = (id: string) => ingredients.get(id) ?? fail('not_found', `ingredient ${id}`);
      /** qadoqsiz birlikdagi miqdor → asosiy birlik; 0 ga yaxlitlanadigan yoki juda katta — `invalid_qty` */
      const baseQty = (qty: number, ingredient: Ingredient) => {
        const base = toBase(qty, ingredient.unit);
        if (!(qty > 0) || base < 1 || base > MAX_STOCK_QTY) fail('invalid_qty', ingredient.id);
        return base;
      };

      const product = ingredientOf(input.ingredientId);
      const produced = baseQty(input.qty, product);
      const consumed = input.items.map((line) => {
        const ingredient = ingredientOf(line.ingredientId);
        if (ingredient.id === product.id) fail('invalid_input', 'items');
        return { ingredient, qty: baseQty(line.qty, ingredient) };
      });

      const needed = mergeDeltas(consumed.map(({ ingredient, qty }) => ({ ingredientId: ingredient.id, qty })));
      const available = await this.stock.lockQty(em, central.id, [...needed.keys()]);
      for (const [ingredientId, qty] of needed) {
        if ((available.get(ingredientId) ?? 0) < qty) fail('insufficient_stock', ingredientId);
      }

      const cost = productionCost(
        consumed.map(({ ingredient, qty }) => ({
          qty,
          unit: ingredient.unit,
          packSize: ingredient.packSize,
          lastPrice: ingredient.lastPrice,
        })),
      );
      const production: Production = {
        id: newId('mfg'),
        number: await nextCounter(em, 'production'),
        warehouseId: central.id,
        ingredientId: product.id,
        qty: input.qty,
        items: input.items.map((line): ProductionItem => ({ ingredientId: line.ingredientId, qty: line.qty })),
        cost,
        note: input.note?.trim() ?? '',
        createdBy,
        createdAt: now,
      };
      await em.insert(Production, production);
      if (cost !== null) {
        await em.update(Ingredient, product.id, {
          lastPrice: producedUnitPrice(cost, produced, product.unit, product.packSize),
        });
      }
      const deltas: StockDelta[] = [
        { ingredientId: product.id, qty: produced },
        ...consumed.map(({ ingredient, qty }) => ({ ingredientId: ingredient.id, qty: -qty })),
      ];
      await this.stock.applyDeltas(em, central.id, deltas, 'production', production.id, now);
      return production;
    });
  }

  // ───────────────────────── Yordamchilar ─────────────────────────

  private async lockPurchase(em: EntityManager, id: string): Promise<Purchase> {
    return (
      (await em.findOne(Purchase, { where: { id }, lock: { mode: 'pessimistic_write' } })) ??
      fail('not_found', `purchase ${id}`)
    );
  }

  /** [lock] — tranzaksiya oxirigacha (qadoq hajmi va narx bir vaqtda o'zgarib qolmasin), id tartibida */
  private async ingredientMap(em: EntityManager, ids: string[], lock = false): Promise<Map<string, Ingredient>> {
    const ingredients = await em.find(Ingredient, {
      where: { id: In(ids) },
      ...(lock && { order: { id: 'ASC' }, lock: { mode: 'pessimistic_write' } }),
    });
    return new Map(ingredients.map((i) => [i.id, i]));
  }

  private async getIngredient(em: EntityManager, id: string, lock = false): Promise<Ingredient> {
    return (
      (await em.findOne(Ingredient, { where: { id }, ...(lock && { lock: { mode: 'pessimistic_write' } }) })) ??
      fail('not_found', `ingredient ${id}`)
    );
  }

  private async getWarehouse(em: EntityManager, id: string): Promise<Warehouse> {
    return (await em.findOneBy(Warehouse, { id })) ?? fail('not_found', `warehouse ${id}`);
  }
}
