import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { IngredientGroup, StockUnit } from '../common/enums';
import type { LocalizedText } from '../common/types';

/**
 * Ombor mahsuloti (xomashyo, qadoq). Hech qayerda ishlatilmagan bo'lsa o'chiriladi; retseptda yoki tarixda bo'lsa —
 * faqat "faol emas" qilinadi.
 */
@Entity('ingredients')
export class Ingredient {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'jsonb' })
  name: LocalizedText;

  @Column({ type: 'varchar', length: 20 })
  group: IngredientGroup;

  /** faqat yangi mahsulotda beriladi — keyin o'zgarmaydi (qoldiq va retseptlar shu birlikda hisoblangan) */
  @Column({ type: 'varchar', length: 4 })
  unit: StockUnit;

  /** oxirgi tasdiqlangan kirimdagi 1 birlik (kg / l / dona) narxi — keyingi kirimda avtomatik yoziladi */
  @Column('bigint', { nullable: true, transformer: bigintNumber })
  lastPrice: number | null;

  @Column({ default: true })
  active: boolean;
}
