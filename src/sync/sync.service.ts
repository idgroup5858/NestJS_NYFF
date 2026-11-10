import { HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { fail } from '../common/errors';
import { sha256 } from '../common/ids';
import { uiBase } from '../common/web-paths';
import type { OrderItem } from '../common/types';
import { dateKey } from '../domain/dates';
import { resolvePayment } from '../domain/payments';
import { imagesDir } from '../images/images-dir';
import { MenuService } from '../menu/menu.service';
import { NO_COURIER, Order } from '../orders/order.entity';
import { orderCounterKey } from '../orders/orders.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { User } from '../users/user.entity';
import { StockService } from '../warehouse/stock.service';
import type { SyncOrderDto } from './sync.dto';
import type { SyncCounter, SyncImage, SyncMenu, SyncOrdersResult, SyncSnapshotResponse } from './sync.types';

const IMAGES_PREFIX = '/images/';
/** Kategoriya ikonkalari web ilovaning o'zida (offline server ham shu ilovani beradi) — yuklanmaydi. */
const ICONS_PREFIX = '/images/icons/';

/** Taom qatorlari: kamida bitta, soni butun ≥ 1, narxi butun ≥ 0 (oddiy kassa buyurtmasidagi xato kodlari bilan). */
function cleanItems(items: OrderItem[]): OrderItem[] {
  if (items.length === 0) fail('empty_order');
  return items.map((item) => {
    if (!Number.isInteger(item.qty) || item.qty < 1) fail('invalid_qty', item.productId);
    if (!Number.isInteger(item.price) || item.price < 0) fail('invalid_amount', item.productId);
    const { uz, ru, en } = item.name;
    return { productId: item.productId, name: { uz, ru, en }, price: item.price, qty: item.qty };
  });
}

/**
 * Filialning offline serveri bilan sinxronlash (`/api/sync/*`, filial kaliti — bazada, `OfflineKeysService`):
 *  - **nusxa** — offline kassaga kerak bo'lgan hamma narsa: kassirlar (PIN xeshi bilan), kassa menyusi, rasmlar
 *    ro'yxati, bugungi buyurtma raqami. Offline server uni ishga tushganda va internet qaytgach oladi;
 *  - **buyurtmalar** — internet yo'q paytda offline kassada olinganlari. Har biri alohida tranzaksiyada: id bo'yicha
 *    takrorlanmaydi, kassirning o'sha paytdagi smenasiga yoziladi, ombordan buyurtma vaqti bilan ayriladi, filialning
 *    o'sha kungi raqam hisoblagichi offline raqamlardan orqada qolmaydi.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly menu: MenuService,
    private readonly stock: StockService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async snapshot(branchId: string, since: string | undefined, now = new Date()): Promise<SyncSnapshotResponse> {
    const em = this.dataSource.manager;
    const branch = await em.findOneBy(Branch, { id: branchId });
    if (!branch?.active) fail('not_found', `branch ${branchId}`);

    const counter = await this.counter(em, branchId, now);
    const cashiers = await em
      .createQueryBuilder(User, 'u')
      .addSelect('u.pinHash')
      .where(`u.role = 'cashier'`)
      // bir nechta filialda ishlaydigan kassir — har birining offline kassasida
      .andWhere('u.branchIds @> CAST(:branchJson AS jsonb)', { branchJson: JSON.stringify([branchId]) })
      .andWhere('u.active = true')
      .orderBy('u.name')
      .addOrderBy('u.id')
      .getMany();
    const menu: SyncMenu = await this.menu.publicMenu(branchId, true);
    const body = {
      branch: { id: branch.id, name: branch.name, address: branch.address },
      cashiers: cashiers.map(({ id, name, surname, pinHash }) => ({ id, name, surname, pinHash })),
      menu,
      images: this.images(menu),
      uiBase: `${uiBase()}/`,
    };
    const version = sha256(JSON.stringify(body));
    if (since === version) return { version, unchanged: true, counter };
    return { version, unchanged: false, ...body, counter };
  }

  async importOrders(branchId: string, orders: SyncOrderDto[], now = new Date()): Promise<SyncOrdersResult> {
    if (!(await this.dataSource.manager.existsBy(Branch, { id: branchId }))) fail('not_found', `branch ${branchId}`);
    const result: SyncOrdersResult = { accepted: [], rejected: [] };
    for (const input of [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      try {
        const changed = await this.dataSource.transaction((em) => this.importOne(em, branchId, input, now));
        result.accepted.push(input.id);
        if (changed) this.realtime.orderChanged(changed);
      } catch (error) {
        // ma'lumot xatosi — bu buyurtma rad etiladi (qolganlari yoziladi); baza / server xatosi — butun so'rov 500,
        // offline server keyinroq qayta yuboradi
        const response = error instanceof HttpException ? (error.getResponse() as { code?: string; detail?: string }) : null;
        if (!response?.code) throw error;
        this.logger.warn(`${branchId}: offline buyurtma ${input.id} rad etildi — ${response.code} ${response.detail ?? ''}`);
        result.rejected.push({ id: input.id, code: response.code, ...(response.detail && { detail: response.detail }) });
      }
    }
    if (result.accepted.length > 0) this.logger.log(`${branchId}: ${result.accepted.length} ta offline buyurtma qabul qilindi`);
    return result;
  }

  /** Yangi buyurtma — yoziladi; bor bo'lsa — faqat holati oldinga siljiydi (o'zgargan bo'lsa qaytadi). */
  private async importOne(em: EntityManager, branchId: string, input: SyncOrderDto, now: Date): Promise<Order | null> {
    const existing = await em.findOne(Order, { where: { id: input.id }, lock: { mode: 'pessimistic_write' } });
    if (existing) return this.advance(em, existing, branchId, input, now);

    const items = cleanItems(input.items);
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const paid = resolvePayment(input.payment, input.split, total);
    // kassa kompyuteri soati oldinda bo'lsa — kelajakdagi vaqt hisobotlarga tushmasin
    const at = (iso: string | null) => (iso ? new Date(Math.min(new Date(iso).getTime(), now.getTime())) : null);
    const createdAt = at(input.createdAt) ?? now;
    const cancelled = input.status === 'cancelled';

    const order: Order = {
      id: input.id,
      branchId,
      number: input.number,
      type: input.type,
      source: 'cashier',
      items,
      note: input.note.trim(),
      total,
      payment: paid.payment,
      split: paid.split,
      online: null,
      status: input.status,
      cashierId: input.cashierId,
      shiftId: await this.shiftAt(em, input.cashierId, branchId, createdAt),
      createdAt,
      preparingAt: createdAt,
      readyAt: input.status === 'ready' ? (at(input.readyAt) ?? createdAt) : null,
      cancelledAt: cancelled ? (at(input.cancelledAt) ?? createdAt) : null,
      cancelledBy: cancelled ? (input.cancelledBy ?? input.cashierId) : null,
      cancelReason: null,
      routedAt: createdAt,
      transferCount: 0,
      fromBranchId: null,
      trackingTokenHash: null,
      ...NO_COURIER,
      syncedAt: now,
    };
    await em.insert(Order, order);
    // bugungi (o'sha kungi) navbatdagi raqam offline berilganlardan keyin davom etsin
    await em.query(
      `INSERT INTO counters ("key", "value") VALUES ($1, $2)
       ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST(counters."value", EXCLUDED."value")`,
      [orderCounterKey(branchId, createdAt), input.number],
    );
    // bekor qilingani omborga tegmaydi (ayirib, qaytarish bilan bir xil)
    if (!cancelled) await this.stock.deductOrder(em, order, createdAt);
    return order;
  }

  /**
   * Allaqachon bor buyurtma (oldingi yuborishda yozilgan, keyin offline'da "Tayyor" yoki bekor qilingan; yoki to'lov
   * paytida internet uzilib, server yozib ulgurgan): holat faqat oldinga — tayyorlanmoqda → tayyor, istalgani → bekor.
   * Markazda allaqachon ilgarilab ketgan bo'lsa — markazniki qoladi.
   */
  private async advance(
    em: EntityManager,
    order: Order,
    branchId: string,
    input: SyncOrderDto,
    now: Date,
  ): Promise<Order | null> {
    if (order.branchId !== branchId) fail('forbidden', `order ${order.id} of other branch`);
    let patch: Partial<Order> | null = null;
    if (input.status === 'ready' && order.status === 'preparing') {
      patch = { status: 'ready', readyAt: input.readyAt ? new Date(input.readyAt) : now };
    } else if (input.status === 'cancelled' && order.status !== 'cancelled' && order.status !== 'pending' && !order.deliveredAt) {
      const cancelledAt = input.cancelledAt ? new Date(input.cancelledAt) : now;
      await this.stock.returnOrder(em, order.id, cancelledAt);
      patch = { status: 'cancelled', cancelledAt, cancelledBy: input.cancelledBy ?? input.cashierId, cancelReason: null };
    }
    if (!patch) return null;
    await em.update(Order, order.id, patch);
    return Object.assign(order, patch);
  }

  /** Buyurtma vaqtida ochiq bo'lgan smena; topilmasa — kassirning hozir ochiq smenasi; u ham yo'q — `null`. */
  private async shiftAt(em: EntityManager, cashierId: string, branchId: string, at: Date): Promise<string | null> {
    // ochiq smena yoki o'sha vaqtni qamragan yopilgani; qamraganlari (ochilgani buyurtmadan oldin) birinchi
    const rows: { id: string }[] = await em.query(
      `SELECT id FROM shifts
       WHERE "cashierId" = $1 AND "branchId" = $2
         AND ("closedAt" IS NULL OR ("openedAt" <= $3 AND "closedAt" >= $3))
       ORDER BY ("openedAt" <= $3) DESC, "openedAt" DESC
       LIMIT 1`,
      [cashierId, branchId, at],
    );
    return rows[0]?.id ?? null;
  }

  private async counter(em: EntityManager, branchId: string, now: Date): Promise<SyncCounter> {
    const rows: { value: number }[] = await em.query(`SELECT "value" FROM counters WHERE "key" = $1`, [
      orderCounterKey(branchId, now),
    ]);
    return { date: dateKey(now), value: rows[0]?.value ?? 0 };
  }

  /** Menyudagi rasmlar (`uploads` papkasidan): hajmi va o'zgargan vaqti bilan; papkada yo'g'i — tashlanadi. */
  private images(menu: SyncMenu): SyncImage[] {
    const root = imagesDir();
    const paths = new Set(
      [...menu.categories, ...menu.products]
        .map((item) => item.image)
        .filter((path) => path.startsWith(IMAGES_PREFIX) && !path.startsWith(ICONS_PREFIX)),
    );
    return [...paths].sort().flatMap((path) => {
      const file = resolve(root, path.slice(IMAGES_PREFIX.length));
      // `..` bilan papkadan tashqariga chiqadigan yo'l — yo'q
      if (relative(root, file).startsWith('..')) return [];
      try {
        const stat = statSync(file);
        return stat.isFile() ? [{ path, size: stat.size, modifiedAt: stat.mtime.toISOString() }] : [];
      } catch {
        return [];
      }
    });
  }
}
