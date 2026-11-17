import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { MovementKind } from '../common/enums';

/** Qoldiqning har bir o'zgarishi — tarix va hisobotlar uchun. */
@Entity('stock_movements')
@Index(['warehouseId', 'ingredientId', 'createdAt'])
// "Xo'jalik sarflari" hisoboti — davr bo'yicha faqat "Sarflandi" (butun jadval millionlab qator)
@Index('IDX_stock_movements_consume_createdAt', ['createdAt'], { where: `"kind" = 'consume'` })
export class StockMovement {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  warehouseId: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  ingredientId: string;

  /** asosiy birlikda: musbat — kirim, manfiy — chiqim */
  @Column({ type: 'int' })
  qty: number;

  @Column({ type: 'varchar', length: 16 })
  kind: MovementKind;

  /** sabab bo'lgan hujjat: buyurtma, kirim yoki ko'chirish id'si */
  @Index()
  @Column({ type: 'varchar', length: ID_LENGTH })
  refId: string;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  /**
   * Faqat "Sarflandi" (`consume`) da: hisobdan chiqqan miqdorning qiymati, so'm — o'sha paytdagi oxirgi narxda (yangi
   * kirim narxidan oldingi). Narxi yo'q edi yoki boshqa harakat — `null`.
   */
  @Column('bigint', { nullable: true, transformer: bigintNumber })
  cost?: number | null;
}
