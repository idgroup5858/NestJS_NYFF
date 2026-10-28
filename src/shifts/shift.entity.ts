import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { ID_LENGTH } from '../common/columns';
import { User } from '../users/user.entity';

/** Kassir smenasi: kirganda ochiladi (yoki davom etadi), "Smenani topshirish" bilan yopiladi. */
@Entity('shifts')
// bir kassirning bir filialda bittadan ortiq ochiq smenasi bo'lmaydi (ikki tabdan bir vaqtda kirsa ham)
@Index(['cashierId', 'branchId'], { unique: true, where: '"closedAt" IS NULL' })
@Index(['branchId', 'openedAt'])
export class Shift {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  @Column({ type: 'varchar', length: ID_LENGTH })
  cashierId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cashierId' })
  cashier?: User;

  @Column({ type: 'timestamptz' })
  openedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
