import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { LatLng, WorkHours } from '../common/types';

@Entity('branches')
export class Branch {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 255, default: '' })
  address: string;

  @Column({ length: 30, default: '' })
  phone: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  /** xaritadagi joyi — hududdan tashqaridagi buyurtma uchun eng yaqin filial shundan topiladi */
  @Column({ type: 'jsonb', nullable: true })
  location: LatLng | null;

  /** yetkazib berish hududi — poligon uchlari (kamida 3 ta); bo'sh — hudud chizilmagan */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  deliveryZone: LatLng[];

  /** hudud ichida yetkazib berish narxi, so'm (0 — bepul); hududdan tashqarida narxni kuryer aytadi */
  @Column('bigint', { default: 0, transformer: bigintNumber })
  deliveryFee: number;

  /** filial yopiq bo'lsa uning hududidagi online buyurtmalar shu filialga; `null` — eng yaqin ochiq filialga */
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  fallbackBranchId: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'fallbackBranchId' })
  fallbackBranch?: Branch | null;

  /** admin to'xtatib qo'ysa (`false`) smena ochiq bo'lsa ham online buyurtma olmaydi */
  @Column({ default: true })
  onlineEnabled: boolean;

  /** online buyurtma qabul qilish vaqti; `null` — belgilanmagan, 24/7 */
  @Column({ type: 'jsonb', nullable: true })
  workHours: WorkHours | null;
}
