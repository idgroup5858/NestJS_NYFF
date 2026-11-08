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

  /**
   * Qoldiq, retsept, chegara, qadoq hajmi va hujjatlardagi sonlar shu birlikda o'qiladi. Tahrirda faqat admin
   * o'zgartiradi — sonlar o'zgarmaydi, yangi birlikda o'qiladi (2026-11-08, `saveIngredient`).
   */
  @Column({ type: 'varchar', length: 4 })
  unit: StockUnit;

  /**
   * Qadoq hajmi asosiy birlikda (g / ml / dona): 600 — 1 dona ketchup 600 g. Berilgan bo'lsa kirim, ko'chirish, narx
   * va qoldiqni ko'rsatish — donada (qadoqda); qoldiq, retsept va chegara baribir asosiy birlikda. `null` — qadoqsiz.
   * O'zgartirsa bo'ladi: qoldiq asosiy birlikda, hujjat qatorlarida o'sha paytdagi hajm saqlanadi.
   */
  @Column('int', { nullable: true })
  packSize: number | null;

  /** oxirgi tasdiqlangan kirimdagi 1 birlik (qadoq bo'lsa — 1 dona, aks holda kg / l / dona) narxi — keyingi kirimda avtomatik yoziladi */
  @Column('bigint', { nullable: true, transformer: bigintNumber })
  lastPrice: number | null;

  @Column({ default: true })
  active: boolean;
}
