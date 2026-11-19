import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ID_LENGTH } from '../common/columns';

export const MOBILE_CARD_STATUSES = ['pending', 'active', 'failed'] as const;
export type MobileCardStatus = (typeof MOBILE_CARD_STATUSES)[number];

/**
 * Mijozning bog'langan kartasi (2026-11-19). Login yo'q — karta **telefonga** bog'lanadi: ilova o'zi yaratgan maxfiy
 * kalit (`X-Client-Key`, telefonda DataStore'da) — bazada faqat uning sha256 xeshi. Bank tokeni (`cardToken`) faqat
 * shu yerda: ilovaga hech qachon berilmaydi, mijozga — yashirin raqam (`maskedPan`). `id` — bog'lash so'rovining
 * bankdagi `orderId` (UUID v7): callback shu bilan topadi. `pending` — bank sahifasi ochilgan, `active` — bank tokenni
 * berdi, `failed` — bog'lanmadi. O'chirilganda yozuv o'chadi (bankda ham uziladi).
 */
@Entity('mobile_cards')
@Index(['clientKeyHash', 'status'])
export class MobileCard {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  clientKeyHash: string;

  @Column({ type: 'varchar', length: 10 })
  status: MobileCardStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  cardToken: string | null;

  /** `9860********4764` */
  @Column({ type: 'varchar', length: 32, nullable: true })
  maskedPan: string | null;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  boundAt: Date | null;
}
