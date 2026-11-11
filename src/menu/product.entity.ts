import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { LocalizedText, RecipeLine } from '../common/types';
import { Category } from './category.entity';

/** Taom shu filialda sotuvdami: faol va filial "vaqtincha sotilmaydi" ro'yxatida emas. */
export const soldAt = (product: Product, branchId: string): boolean =>
  product.active && !product.unavailableBranchIds.includes(branchId);

@Entity('products')
export class Product {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Index()
  @Column({ type: 'varchar', length: ID_LENGTH })
  categoryId: string;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'categoryId' })
  category?: Category;

  @Column({ type: 'jsonb' })
  name: LocalizedText;

  @Column({ length: 255, default: '' })
  image: string;

  /** bitta taomga ketadigan mahsulotlar (asosiy birlikda) — sotilganda filial omboridan shu miqdorlar ayriladi */
  @Column({ type: 'jsonb' })
  recipe: RecipeLine[];

  /** sotuv narxi (so'm) — barcha filiallarda bir xil */
  @Column('bigint', { transformer: bigintNumber })
  price: number;

  /** taom vaqtincha sotilmaydigan filiallar (masalan, mahsuloti tugagan); yangi filial — hamma taomni sotadi */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  unavailableBranchIds: string[];

  @Column({ type: 'int' })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;

  /** `false` — oshxona chekiga chiqmaydi (tayyor ichimlik: kola, suv — kassir o'zi beradi; choy, qahva — chiqadi) */
  @Column({ default: true })
  kitchen: boolean;

  /**
   * `true` — truck chekiga chiqadi (truck printeri — kassa kompyuterida, "NYFF Offline"). `kitchen` dan mustaqil: ikkalasi
   * yoqiq taom ikkala chekda chiqadi.
   */
  @Column({ default: false })
  truck: boolean;

  /**
   * `true` — faqat zalda beriladi (choynakdagi choy, idishdagi taom): olib ketish va dostavka buyurtmasiga qo'shilmaydi,
   * mobil ilovada ko'rsatilmaydi.
   */
  @Column({ default: false })
  dineInOnly: boolean;
}
