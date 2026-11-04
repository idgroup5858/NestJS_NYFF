import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { EventEmitter } from 'node:events';
import type {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  TransactionCommitEvent,
  TransactionRollbackEvent,
} from 'typeorm';

/** Ombordagi mahsulot qoldig'i chegaradan pastga tushdi (avval `qty ≥ minQty` edi, endi `qty < minQty`). */
export interface LowStockCrossing {
  warehouseId: string;
  ingredientId: string;
}

/** `QueryRunner.data` dagi kalit — tranzaksiya davomida yig'ilganlar. */
const PENDING = 'lowStockCrossings';

/**
 * "Kam qoldi" voqeasi — Telegram botga darhol xabar shu bo'yicha ketadi. Qoldiq tranzaksiya ichida o'zgaradi (sotuv,
 * ko'chirish, offline sync), shuning uchun voqea **tranzaksiya tugagach** chiqadi: tranzaksiya davomida `QueryRunner`
 * ga yig'iladi, `COMMIT` dan keyin bitta voqea bo'lib ketadi, `ROLLBACK` da tashlanadi (TypeORM subscriber). Alohida
 * servis — ombor moduli Telegram moduliga bog'lanmasin (`ShiftEvents` dagidek).
 */
@Injectable()
export class LowStockEvents implements EntitySubscriberInterface {
  private readonly emitter = new EventEmitter();

  constructor(@InjectDataSource() dataSource: DataSource) {
    dataSource.subscribers.push(this);
  }

  /** [em] tranzaksiyada bo'lsa — u tugagach chiqadi; tranzaksiyasiz — darhol. */
  add(em: EntityManager, crossings: LowStockCrossing[]): void {
    if (crossings.length === 0) return;
    const runner = em.queryRunner;
    if (!runner?.isTransactionActive) return this.emit(crossings);
    const pending = (runner.data[PENDING] ??= []) as LowStockCrossing[];
    pending.push(...crossings);
  }

  onLow(listener: (crossings: LowStockCrossing[]) => void): void {
    this.emitter.on('low', listener);
  }

  afterTransactionCommit({ queryRunner }: TransactionCommitEvent): void {
    // ichki savepoint tugadi — tashqi tranzaksiya hali davom etyapti
    if (queryRunner.isTransactionActive) return;
    const pending = queryRunner.data[PENDING] as LowStockCrossing[] | undefined;
    if (!pending?.length) return;
    delete queryRunner.data[PENDING];
    this.emit(pending);
  }

  afterTransactionRollback({ queryRunner }: TransactionRollbackEvent): void {
    if (!queryRunner.isTransactionActive) delete queryRunner.data[PENDING];
  }

  private emit(crossings: LowStockCrossing[]): void {
    try {
      this.emitter.emit('low', crossings);
    } catch {
      // tinglovchi xatosi so'rovni yiqitmasin — ma'lumot allaqachon saqlangan
    }
  }
}
