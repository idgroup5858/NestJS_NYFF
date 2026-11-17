import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Warehouse } from '../branches/warehouse.entity';
import { ID_LENGTH } from '../common/columns';
import { Ingredient } from './ingredient.entity';

/** Ombordagi qoldiq. Yozuv bo'lmasa qoldiq 0, ogohlantirish chegarasi yo'q. */
@Entity('stock')
export class StockItem {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  warehouseId: string;

  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  ingredientId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @ManyToOne(() => Ingredient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ingredientId' })
  ingredient?: Ingredient;

  /** asosiy birlikda; sotuv qoldiqdan oshsa manfiy bo'lishi mumkin (savdo to'xtamaydi) */
  @Column({ type: 'int', default: 0 })
  qty: number;

  /** asosiy birlikda; qoldiq shundan kam bo'lsa — ogohlantirish. 0 — kuzatilmaydi */
  @Column({ type: 'int', default: 0 })
  minQty: number;
}
