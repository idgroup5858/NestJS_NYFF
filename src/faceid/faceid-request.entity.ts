import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { ID_LENGTH } from '../common/columns';
import type { FaceIdNeed } from '../domain/faceid';
import { User } from '../users/user.entity';

export type FaceIdRequestStatus = 'pending' | 'approved' | 'rejected';

/** Telegram'da yuborilgan so'rov xabari — qaror qilingach hammasi tahrirlanadi (tugmalar olib tashlanadi). */
export interface FaceIdRequestMessage {
  chatId: string;
  messageId: number;
}

/**
 * Kassir terminaldan o'tolmadi (buzilgan, internet yo'q…) — admindan Telegram orqali ruxsat so'radi. Ruxsat berilsa
 * — shu kassirga, shu filialda 10 daqiqa FaceID tekshiruvisiz (`FaceIdService.granted`).
 */
@Entity('faceid_requests')
@Index(['userId', 'branchId', 'createdAt'])
export class FaceIdRequest {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: ID_LENGTH })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  /** kassir nima qilmoqchi edi (Telegram xabarida ko'rsatiladi) */
  @Column({ type: 'varchar', length: 8 })
  action: FaceIdNeed;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: FaceIdRequestStatus;

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /** qaror qilgan admin */
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  decidedBy: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decidedBy' })
  decider?: User | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  messages: FaceIdRequestMessage[];
}
