import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { IngredientGroup, StockUnit } from '../common/enums';
import type { LocalizedText } from '../common/types';
import type { YieldNorm } from '../domain/yield-norm';

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

  /**
   * 1 birlik (qadoq bo'lsa — 1 dona, aks holda kg / l / dona) narxi: oxirgi kirimdagi yoki mahsulot oynasida (admin,
   * ta'minotchi) yozilgani — keyingi kirimda avtomatik yoziladi
   */
  @Column('bigint', { nullable: true, transformer: bigintNumber })
  lastPrice: number | null;

  /**
   * Sarf materiali (2026-11-18): salfetka, yuvish vositalari, gubka — sarfini o'lchab bo'lmaydiganlar. Omborga yangi
   * partiya kelganda (kirim, ko'chirish) undagi eski qoldiq "Sarflandi" bo'ladi (`consume`, `StockService.
   * writeOffConsumables`); "kam qoldi" ogohlantirishlariga kirmaydi. O'zgartirilsa qoldiqqa tegilmaydi — keyingi
   * partiyadan ishlaydi.
   */
  @Column({ default: false })
  consumable: boolean;

  /**
   * Norma (2026-11-19, faqat admin): bir marta o'lchangan namuna — 64 kg tovuqdan 34,5 kg yarim tayyor go'sht va 5 kg
   * qanot chiqadi. Berilgan bo'lsa kirimda bu mahsulot o'zi omborga qo'shilmaydi — shu nisbatda chiqqanlari qo'shiladi
   * (`WarehouseService.receive`), narx ularga og'irligi bo'yicha bo'linadi. Chiqqanlar shu mahsulot bilan bir o'lchamda
   * (kg / l yoki dona), o'zlarining normasi yo'q. `null` — oddiy mahsulot.
   */
  @Column({ type: 'jsonb', nullable: true })
  yieldNorm: YieldNorm | null;

  /**
   * Pishganda chiqishi (2026-11-19, faqat admin, kg / l da): 1000 g xomdan shuncha g pishgan — 655. Berilgan bo'lsa
   * taom retseptidagi son **pishgan** miqdor: sotuvda ombordan xomi ayriladi (100 g → 153 g), tannarx ham shundan.
   * `null` — retseptdagi son o'zi.
   */
  @Column('int', { nullable: true })
  cookYield: number | null;

  @Column({ default: true })
  active: boolean;
}
