import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { Warehouse } from '../branches/warehouse.entity';
import type { Role } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { pageParams, type Page } from '../common/pagination';
import type { PurchaseItem, TransferItem } from '../common/types';
import { nextCounter } from '../database/counters';
import { toBase } from '../domain/units';
import { Ingredient } from './ingredient.entity';
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

@Injectable()
export class WarehouseService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stock: StockService,
  ) {}

  // ───────────────────────── Omborlar, mahsulotlar, qoldiq ─────────────────────────

  warehouses() {
    return this.dataSource.manager.find(Warehouse, { order: { kind: 'DESC', name: 'ASC' } });
  }

  ingredients() {
    return this.dataSource.manager.find(Ingredient, { order: { group: 'ASC', id: 'ASC' } });
  }

  /** Ombor mahsuloti. Narxni ([lastPrice]) faqat admin kiritadi — ta'minotchi yuborsa `forbidden`. */
  async saveIngredient(
    input: (CreateIngredientDto | UpdateIngredientDto) & { id?: string },
    actorRole: Role,
  ): Promise<Ingredient> {
    const em = this.dataSource.manager;
    const name = { uz: input.name.uz.trim(), ru: input.name.ru.trim(), en: input.name.en.trim() };
    if (!name.uz) fail('name_required');
    const lastPrice = input.lastPrice;
    if (lastPrice !== undefined) {
      if (actorRole !== 'admin') fail('forbidden', 'lastPrice');
      if (lastPrice !== null && (!Number.isInteger(lastPrice) || lastPrice < 0)) fail('invalid_price');
    }
    if (input.id) {
      await this.getIngredient(em, input.id);
      await em.update(Ingredient, input.id, {
        name,
        group: input.group,
        active: input.active,
        ...(lastPrice !== undefined && { lastPrice }),
      });
      return this.getIngredient(em, input.id);
    }
    const unit = (input as CreateIngredientDto).unit ?? fail('invalid_input', 'unit');
    const ingredient: Ingredient = {
      id: newId('ing'),
      name,
      group: input.group,
      unit,
      lastPrice: lastPrice ?? null,
      active: input.active,
    };
    await em.insert(Ingredient, ingredient);
    return ingredient;
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
   * Ta'minotchi kirimni kiritadi: hali omborga qo'shilmaydi. Narx oldingi tasdiqlangan kirimdan avtomatik yoziladi,
   * admin uni tasdiqlashda o'zgartirishi mumkin.
   */
  async createPurchase(input: CreatePurchaseDto, createdBy: string, now = new Date()): Promise<Purchase> {
    return this.dataSource.transaction(async (em) => {
      if (input.items.length === 0) fail('empty_order');
      await this.getWarehouse(em, input.warehouseId);
      const ingredients = await this.ingredientMap(em, input.items.map((line) => line.ingredientId));
      const items: PurchaseItem[] = input.items.map((line) => {
        const ingredient = ingredients.get(line.ingredientId) ?? fail('not_found', `ingredient ${line.ingredientId}`);
        if (!(line.qty > 0)) fail('invalid_qty', ingredient.id);
        return { ingredientId: ingredient.id, qty: line.qty, price: ingredient.lastPrice };
      });
      const purchase: Purchase = {
        id: newId('pur'),
        number: await nextCounter(em, 'purchase'),
        warehouseId: input.warehouseId,
        items,
        note: input.note?.trim() ?? '',
        status: 'pending',
        createdBy,
        createdAt: now,
        decidedBy: null,
        decidedAt: null,
      };
      await em.insert(Purchase, purchase);
      return purchase;
    });
  }

  /**
   * Admin narxlarni kiritib tasdiqlaydi: mahsulotlar omborga qo'shiladi, har bir mahsulotning "oxirgi narxi" yangilanadi.
   * [prices] — mahsulot id → 1 birlik narxi; berilmaganlari kirimdagi narxida qoladi.
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
      const ingredients = await this.ingredientMap(em, items.map((item) => item.ingredientId));
      for (const item of items) await em.update(Ingredient, item.ingredientId, { lastPrice: item.price });

      const approved: Purchase = { ...purchase, items, status: 'approved', decidedBy: adminId, decidedAt: now };
      await em.update(Purchase, id, { items, status: 'approved', decidedBy: adminId, decidedAt: now });
      const deltas = items.map((item) => {
        const ingredient = ingredients.get(item.ingredientId) ?? fail('not_found', `ingredient ${item.ingredientId}`);
        return { ingredientId: item.ingredientId, qty: toBase(item.qty, ingredient.unit) };
      });
      await this.stock.applyDeltas(em, purchase.warehouseId, deltas, 'purchase', purchase.id, now);
      return approved;
    });
  }

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
        return { ingredientId: ingredient.id, qty: toBase(item.qty, ingredient.unit) };
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
        items: input.items.map((item): TransferItem => ({ ingredientId: item.ingredientId, qty: item.qty })),
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

  private async ingredientMap(em: EntityManager, ids: string[]): Promise<Map<string, Ingredient>> {
    const ingredients = await em.findBy(Ingredient, { id: In(ids) });
    return new Map(ingredients.map((i) => [i.id, i]));
  }

  private async getIngredient(em: EntityManager, id: string): Promise<Ingredient> {
    return (await em.findOneBy(Ingredient, { id })) ?? fail('not_found', `ingredient ${id}`);
  }

  private async getWarehouse(em: EntityManager, id: string): Promise<Warehouse> {
    return (await em.findOneBy(Warehouse, { id })) ?? fail('not_found', `warehouse ${id}`);
  }
}
