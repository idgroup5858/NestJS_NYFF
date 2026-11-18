import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { bigintNumber, ID_LENGTH } from '../common/columns';
import type { MobilePaymentStatus, OrderType } from '../common/enums';
import type { OnlineInfo, OrderItem } from '../common/types';

/**
 * Mobil ilovada karta bilan to'lov (Milliy Ecom / NBU, 2026-11-18). Buyurtma **to'lovdan keyin** yaratiladi: shu yozuv
 * bank sahifasi ochilganda paydo bo'ladi, filial / oshxona / TV uni ko'rmaydi; bank "to'landi" desa — buyurtma
 * (`orders`, `pending`, kassir qabul qiladi) shu yerdagi ma'lumotdan tuziladi. `id` — bankka `orderId` bo'lib ketadi
 * (bank UUID kutadi).
 */
@Entity('mobile_payments')
@Index(['status', 'createdAt'])
export class MobilePayment {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: 10 })
  status: MobilePaymentStatus;

  /** to'lov ochilgandagi filial (dostavkada — server tanlagani); yopilib qolsa — buyurtma avvalgidek o'tkaziladi / bekor */
  @Column({ type: 'varchar', length: ID_LENGTH })
  branchId: string;

  @Column({ type: 'varchar', length: 10 })
  type: OrderType;

  /** mijoz yuborgan qatorlar */
  @Column({ type: 'jsonb' })
  lines: { productId: string; qty: number }[];

  /** to'lov ochilgandagi nom va narx — buyurtma aynan shu narxlar bilan yoziladi (mijoz shu summani to'lagan) */
  @Column({ type: 'jsonb' })
  items: OrderItem[];

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ type: 'jsonb' })
  online: OnlineInfo;

  @Column('bigint', { nullable: true, transformer: bigintNumber })
  deliveryFee: number | null;

  /** taomlar summasi, so'mda (bankka tiyinda — ×100) */
  @Column('bigint', { transformer: bigintNumber })
  total: number;

  /** buyurtma yaratilganda unga ko'chadi — ilova bir token bilan avval to'lovni, keyin buyurtmani kuzatadi */
  @Column({ type: 'varchar', length: 64, select: false })
  trackingTokenHash: string;

  @Column({ type: 'text', nullable: true })
  paymentUrl: string | null;

  /** bankdagi tranzaksiya */
  @Column({ type: 'varchar', length: 64, nullable: true })
  transactionId: string | null;

  /** to'langandan keyin yaratilgan buyurtma */
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  orderId: string | null;

  /** to'langan, lekin buyurtma yaratilmadi — xato kodi (admin pulni qaytaradi) */
  @Column({ type: 'varchar', length: 40, nullable: true })
  error: string | null;

  /** bankdan kelgan oxirgi xabar (callback yoki holat javobi) — tekshirish uchun */
  @Column({ type: 'jsonb', nullable: true })
  bank: object | null;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  /** bank sahifasi shu vaqtgacha ochiq */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** bankdan holat oxirgi marta so'ralgan vaqt */
  @Column({ type: 'timestamptz', nullable: true })
  checkedAt: Date | null;
}
