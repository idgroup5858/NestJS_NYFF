import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ID_LENGTH } from '../common/columns';

/**
 * Qoldiqni 0 ga tushirish (2026-11-10, faqat admin): bitta mahsulot yoki butun ombor. O'zgarishlarning o'zi —
 * `stock_movements` da (`kind = 'adjust'`, `refId` — shu hujjat), bu yerda — raqami, kim va qachon.
 */
@Entity('stock_adjustments')
export class StockAdjustment {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'int' })
  number: number;

  @Column({ type: 'varchar', length: ID_LENGTH })
  warehouseId: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  createdBy: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
