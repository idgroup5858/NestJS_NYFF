import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Warehouse } from '../branches/warehouse.entity';
import { ID_LENGTH } from '../common/columns';
import type { PurchaseStatus } from '../common/enums';
import type { PurchaseItem } from '../common/types';

/** Ta'minotchi kiritgan kirim. Admin narxlarni kiritib tasdiqlamaguncha omborga qo'shilmaydi. */
@Entity('purchases')
export class Purchase {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'int' })
  number: number;

  @Column({ type: 'varchar', length: ID_LENGTH })
  warehouseId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  /** hujjat qatorlari — doim hujjat bilan birga o'qiladi (qoldiqqa ta'siri `stock_movements` da) */
  @Column({ type: 'jsonb' })
  items: PurchaseItem[];

  @Column({ type: 'text', default: '' })
  note: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  status: PurchaseStatus;

  @Column({ type: 'varchar', length: ID_LENGTH })
  createdBy: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  decidedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
}
