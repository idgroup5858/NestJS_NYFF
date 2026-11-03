import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ID_LENGTH } from '../common/columns';
import type { LocalizedText } from '../common/types';

@Entity('categories')
export class Category {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'jsonb' })
  name: LocalizedText;

  @Column({ length: 255, default: '' })
  image: string;

  /** ikonka ("Zamonaviy" mavzuda rasm o'rnida); bo'sh satr — ikonkasiz */
  @Column({ length: 255, default: '' })
  icon: string;

  @Column({ type: 'int' })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;

  /** `false` — taomlari oshxona chekiga chiqmaydi (ichimliklar: kassir o'zi beradi) */
  @Column({ default: true })
  kitchen: boolean;
}
