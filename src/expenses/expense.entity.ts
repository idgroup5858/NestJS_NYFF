import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { ExpenseKind } from '../common/enums';

/** Chiqim — hozircha faqat kommunal to'lovlar; hisobotda tushumdan ayriladi. */
@Entity('expenses')
@Index(['branchId', 'date'])
export class Expense {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  @Column({ type: 'varchar', length: 16 })
  kind: ExpenseKind;

  @Column('bigint', { transformer: bigintNumber })
  amount: number;

  /** mahalliy sana `YYYY-MM-DD` */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  createdBy: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
