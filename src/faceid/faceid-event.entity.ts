import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { ID_LENGTH } from '../common/columns';
import type { FaceIdStatus } from '../domain/faceid';
import { User } from '../users/user.entity';

/**
 * Kassirning terminaldan o'tishi — filial HR tizimi yuborgan «Kirish» / «Chiqish» (faqat tabel raqami kassirnikiga mos
 * kelganlari saqlanadi). Takrori (HR qayta yuborsa) — bir xil xodim, filial va vaqt bo'yicha tashlanadi; shu indeks
 * "kassirning oxirgi hodisasi" so'rovini ham beradi.
 */
@Entity('faceid_events')
@Index(['userId', 'occurredAt', 'branchId'], { unique: true })
export class FaceIdEvent {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  @Column({ type: 'varchar', length: ID_LENGTH })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  @Column({ type: 'varchar', length: ID_LENGTH })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** HR / terminaldagi tabel raqami (o'sha paytdagi) */
  @Column({ type: 'int' })
  employeeNo: number;

  @Column({ type: 'varchar', length: 10 })
  status: FaceIdStatus;

  /** terminalda o'tilgan vaqt; kelajakdagisi (soat oldinda) — qabul qilingan vaqt bilan */
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  /** markazga yetib kelgan vaqt (internet yo'q bo'lsa HR navbatda ushlab turadi) */
  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  /** terminal nomi (HR'dagi) */
  @Column({ length: 100, default: '' })
  device: string;
}
