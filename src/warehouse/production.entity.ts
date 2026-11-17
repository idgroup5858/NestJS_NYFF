import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { ProductionItem } from '../common/types';

/**
 * "Tayyorlash №N" (2026-11-18): markaziy omborda bir nechta mahsulotdan yangisi yasaldi — go'sht, tuxum, yog' → katlet.
 * Oshpaz haqiqatda qancha sarflaganini aytadi, chiqqan sonini sanab yozadi: sarflanganlar ombordan ayriladi, tayyor
 * mahsulot qo'shiladi (`stock_movements`, `kind = 'production'`, `refId` — shu hujjat). Miqdorlar qadoqsiz birlikda —
 * kg / l / dona.
 */
@Entity('productions')
export class Production {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'int' })
  number: number;

  @Column({ type: 'varchar', length: ID_LENGTH })
  warehouseId: string;

  /** tayyor mahsulot — "oxirgi tayyorlash" shu bo'yicha qidiriladi (sarflanganlar ro'yxatini oldindan to'ldirish) */
  @Index()
  @Column({ type: 'varchar', length: ID_LENGTH })
  ingredientId: string;

  /** chiqqan miqdor, kg / l / dona (qadoqsiz) */
  @Column({ type: 'double precision' })
  qty: number;

  /** sarflangan mahsulotlar — doim hujjat bilan birga o'qiladi */
  @Column({ type: 'jsonb' })
  items: ProductionItem[];

  /**
   * Tannarx, so'm: sarflanganlar × ularning o'sha paytdagi oxirgi narxi. Birortasining narxi bo'lmasa — `null` (tayyor
   * mahsulot narxi ham o'zgarmaydi).
   */
  @Column('bigint', { nullable: true, transformer: bigintNumber })
  cost: number | null;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  createdBy: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
