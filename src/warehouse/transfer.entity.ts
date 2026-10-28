import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ID_LENGTH } from '../common/columns';
import type { TransferItem } from '../common/types';

/** Omborlar orasidagi ko'chirish (markaziy → filial yoki filial → filial). */
@Entity('transfers')
export class Transfer {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'int' })
  number: number;

  @Column({ type: 'varchar', length: ID_LENGTH })
  fromWarehouseId: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  toWarehouseId: string;

  @Column({ type: 'jsonb' })
  items: TransferItem[];

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  createdBy: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
