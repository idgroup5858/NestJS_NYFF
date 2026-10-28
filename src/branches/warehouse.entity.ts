import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ID_LENGTH } from '../common/columns';
import type { WarehouseKind } from '../common/enums';
import { Branch } from './branch.entity';

/** Har bir filialning o'z ombori + bitta markaziy ombor. Yangi filialga ombor avtomatik ochiladi. */
@Entity('warehouses')
export class Warehouse {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  kind: WarehouseKind;

  /** filial ombori uchun — qaysi filialniki; markaziy omborda `null` */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  branchId: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch | null;
}
