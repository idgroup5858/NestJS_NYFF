import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { Warehouse } from '../branches/warehouse.entity';
import type { Role } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { assertUnused } from '../common/in-use';
import { pageParams, type Page } from '../common/pagination';
import type { LocalizedText, PurchaseItem, RecipeLine, TransferItem } from '../common/types';
import { nextCounter } from '../database/counters';
import { convertPrice, sameScale, toBase, unitSize } from '../domain/units';
import { Ingredient } from './ingredient.entity';
import { PurchaseEvents } from './purchase-events';
import { Purchase } from './purchase.entity';
import { StockItem } from './stock-item.entity';
import { StockMovement } from './stock-movement.entity';
import { StockService } from './stock.service';
import { Transfer } from './transfer.entity';
import {
  CreateIngredientDto,
  CreatePurchaseDto,
  CreateTransferDto,
  MovementsQuery,
  PurchasesQuery,
  TransfersQuery,
  UpdateIngredientDto,
} from './warehouse.dto';

export type MovementWithRef = StockMovement & { refNumber: number | null; refWarehouseId: string | null };

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
}

/** Qadoq hajmining yuqori chegarasi (asosiy birlikda): 1 dona = 1 t / 1000 l / 1 mln dona. */
const MAX_PACK_SIZE = 1_000_000;

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
   * Ombor mahsuloti. Narxni ([lastPrice]) bu yerda faqat admin kiritadi — ta'minotchi yuborsa `forbidden` (ta'minotchi
   * narxni kirimda yozadi — oxirgi narx shunga yangilanadi). Qadoq hajmi
   * ([packSize]) o'zgarib, narx yuborilmagan bo'lsa (ta'minotchi tahriri) — eski narx yangi birlikka qayta hisoblanadi
   * (28 000 / kg → 600 g lik qadoq — 16 800 / dona); admin yuborgan narx — yangi birlikda.
   *
   * Birlik ([unit]) tahrirda — faqat admin (2026-11-08). Qoldiq, chegara, retseptlar, qadoq hajmi va hujjatlardagi
   * sonlar o'zgarmaydi (foydalanuvchi tanladi) — web avval ogohlantirib, qayerlarni qayta tekshirishni ko'rsatadi
   * ([ingredientUsage]). kg / l ↔ dona: narx yuborilmasa bo'shatiladi (28 000 / kg dan "28 / dona" — ma'nosiz); tasdiq
   * kutayotgan eski kirimda bo'lsa — `pending_purchase` (tasdiqlanganda miqdor yangi birlikda hisoblanib, omborga
   * noto'g'ri son qo'shilardi: 12,5 kg → 13 dona). kg ↔ l — ikkalasi ×1000, sonlar to'g'ri qoladi: faqat birlik almashadi.
   */
  async saveIngredient(
    input: (CreateIngredientDto | UpdateIngredientDto) & { id?: string },
    actorRole: Role,
  ): Promise<Ingredient> {
    const name = { uz: input.name.uz.trim(), ru: input.name.ru.trim(), en: input.name.en.trim() };
    if (!name.uz) fail('name_required');
    const lastPrice = input.lastPrice;
    if (lastPrice !== undefined) {
      if (actorRole !== 'admin') fail('forbidden', 'lastPrice');
      if (lastPrice !== null && (!Number.isInteger(lastPrice) || lastPrice < 0)) fail('invalid_price');
    }
    const packSize = input.packSize;
    if (packSize != null && (!Number.isInteger(packSize) || packSize < 1 || packSize > MAX_PACK_SIZE)) {
      fail('invalid_qty', 'packSize');
    }
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
        }
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
          ...(reunit && { unit }),
          ...(repack && { packSize }),
          ...(repriced !== undefined && { lastPrice: repriced }),
        });
        return this.getIngredient(em, id);
      });
    }
    const unit = input.unit ?? fail('invalid_input', 'unit');
    const ingredient: Ingredient = {
      id: newId('ing'),
      name,
      group: input.group,
      unit,
      packSize: packSize ?? null,
      lastPrice: lastPrice ?? null,
      active: input.active,
    };
    await this.dataSource.manager.insert(Ingredient, ingredient);
    return ingredient;
  }

  /**
   * Ombor mahsulotini o'chirish — hech qayerda ishlatilmagan bo'lsa: taom retseptida, kirimda, ko'chirishda, qoldiq
   * harakatida yo'q. Aks holda `in_use` — faolsizlantirish kerak. Qoldiq yozuvlari (harakatsiz — 0) u bilan o'chadi.
   */
  async removeIngredient(id: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await this.getIngredient(em, id);
      await assertUnused(em, id, {
        recipes: `SELECT 1 FROM products WHERE ${containsIngredient('recipe')} LIMIT 1`,
        purchases: `SELECT 1 FROM purchases WHERE ${containsIngredient('items')} LIMIT 1`,
        transfers: `SELECT 1 FROM transfers WHERE ${containsIngredient('items')} LIMIT 1`,
        movements: `SELECT 1 FROM stock_movements WHERE "ingredientId" = $1 LIMIT 1`,
      });
      await em.delete(StockItem, { ingredientId: id });
      await em.delete(Ingredient, { id });
    });
  }

  /**
   * Birlikni o'zgartirishdan oldin (web ogohlantirish oynasi): sonlari eski birlikda turgan joylar — retseptida bor
   * taomlar (1 porsiyaga, asosiy birlikda), qoldig'i yoki chegarasi bor omborlar, kirim va ko'chirishlar soni, tasdiq
   * kutayotgan eski kirimlar (ular bo'lsa kg / l ↔ dona — `pending_purchase`).
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
      em.query<Record<'purchases' | 'pendingPurchases' | 'transfers', string>[]>(
        `SELECT (SELECT COUNT(*) FROM purchases WHERE ${containsIngredient('items')}) AS purchases,
           (SELECT COUNT(*) FROM purchases WHERE status = 'pending' AND ${containsIngredient('items')})
             AS "pendingPurchases",
           (SELECT COUNT(*) FROM transfers WHERE ${containsIngredient('items')}) AS transfers`,
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
    };
  }

  stockItems(warehouseId?: string) {
    return this.dataSource.manager.find(StockItem, { where: warehouseId ? { warehouseId } : {} });
  }

  /** Ogohlantirish: chegarasi qo'yilgan va qoldig'i chegaradan kam mahsulotlar. */
  lowStock(warehouseId?: string) {
    const qb = this.dataSource.manager
      .createQueryBuilder(StockItem, 's')
      .where('s.minQty > 0')
      .andWhere('s.qty < s.minQty');
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
   * Harakatlar (yangisi birinchi) — sabab bo'lgan hujjat raqami bilan: buyurtma, kirim yoki ko'chirish raqami
   * (`refNumber`); ko'chirishda — ikkinchi ombor (`refWarehouseId`: kirimda qayerdan, chiqimda qayerga).
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
           COALESCE(o.number, p.number, t.number) AS "refNumber",
           CASE m.kind WHEN 'transfer_in' THEN t."fromWarehouseId" WHEN 'transfer_out' THEN t."toWarehouseId" END
             AS "refWarehouseId"
         FROM stock_movements m
         LEFT JOIN orders o ON m.kind IN ('sale', 'sale_cancel') AND o.id = m."refId"
         LEFT JOIN purchases p ON m.kind = 'purchase' AND p.id = m."refId"
         LEFT JOIN transfers t ON m.kind IN ('transfer_in', 'transfer_out') AND t.id = m."refId"
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
   * yangilanadi; yozilmasa — oxirgi narx, u ham yo'q bo'lsa `invalid_price`. Saqlangach — Telegram'ga "Yangi kirim".
   */
  async createPurchase(input: CreatePurchaseDto, createdBy: string, now = new Date()): Promise<Purchase> {
    const purchase = await this.dataSource.transaction(async (em) => {
      if (input.items.length === 0) fail('empty_order');
      await this.getWarehouse(em, input.warehouseId);
      // narx va qadoq hajmi bir vaqtda o'zgarib qolmasin — qatorlar qulflanadi
      const ingredients = await this.ingredientMap(em, input.items.map((line) => line.ingredientId), true);
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

      const created: Purchase = {
        id: newId('pur'),
        number: await nextCounter(em, 'purchase'),
        warehouseId: input.warehouseId,
        items,
        note: input.note?.trim() ?? '',
        status: 'approved',
        createdBy,
        createdAt: now,
        decidedBy: null,
        decidedAt: null,
      };
      await em.insert(Purchase, created);
      const deltas = items.map((item) => ({
        ingredientId: item.ingredientId,
        qty: toBase(item.qty, ingredientOf(item.ingredientId).unit, item.packSize),
      }));
      await this.stock.applyDeltas(em, created.warehouseId, deltas, 'purchase', created.id, now);
      return created;
    });
    this.purchaseEvents.created(purchase);
    return purchase;
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
      const ingredients = await this.ingredientMap(em, items.map((item) => item.ingredientId), true);
      const ingredientOf = (item: PurchaseItem) =>
        ingredients.get(item.ingredientId) ?? fail('not_found', `ingredient ${item.ingredientId}`);
      for (const item of items) {
        const ingredient = ingredientOf(item);
        const lineSize = unitSize(ingredient.unit, item.packSize);
        const currentSize = unitSize(ingredient.unit, ingredient.packSize);
        const lastPrice = lineSize === currentSize ? item.price! : convertPrice(item.price!, lineSize, currentSize);
        await em.update(Ingredient, item.ingredientId, { lastPrice });
      }

      const approved: Purchase = { ...purchase, items, status: 'approved', decidedBy: adminId, decidedAt: now };
      await em.update(Purchase, id, { items, status: 'approved', decidedBy: adminId, decidedAt: now });
      const deltas = items.map((item) => ({
        ingredientId: item.ingredientId,
        qty: toBase(item.qty, ingredientOf(item).unit, item.packSize),
      }));
      await this.stock.applyDeltas(em, purchase.warehouseId, deltas, 'purchase', purchase.id, now);
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
      await this.stock.applyDeltas(em, input.toWarehouseId, baseDeltas, 'transfer_in', transfer.id, now);
      return transfer;
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
