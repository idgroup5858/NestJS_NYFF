import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { ID_LENGTH } from '../common/columns';
import type { Role } from '../common/enums';

/** Ekrandagi ism: "Ism Familiya" (familiya bo'sh bo'lsa — faqat ism). */
export const fullName = (person: { name: string; surname: string }): string =>
  [person.name, person.surname].filter(Boolean).join(' ');

@Entity('users')
export class User {
  @PrimaryColumn({ type: 'varchar', length: ID_LENGTH })
  id: string;

  /** ism; ekranda — "Ism Familiya" (`fullName`) */
  @Column({ length: 100 })
  name: string;

  /** familiya — yangi va tahrirlangan xodimda majburiy; 2026-11-02 dan oldingi xodimlarda bo'sh bo'lishi mumkin */
  @Column({ length: 100, default: '' })
  surname: string;

  @Column({ type: 'varchar', length: 16 })
  role: Role;

  /** kassir va oshpaz yordamchisi — filialga bog'langan; admin, ta'minotchi va kuryer — `null` */
  @Column({ type: 'varchar', length: ID_LENGTH, nullable: true })
  branchId: string | null;

  /**
   * Admin va kuryer (`usesPassword`): kirish emaili (kichik harfda, takrorlanmaydi); parol xeshi — [pinHash] da. PIN
   * bilan kiradiganlarda `null`.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch | null;

  /** PIN (admin va kuryerda — parol) o'zi saqlanmaydi — faqat bcrypt xeshi. Oddiy so'rovlarda yuklanmaydi (`select: false`). */
  @Column({ length: 100, select: false })
  pinHash: string;

  /** ketma-ket noto'g'ri PIN — 5 taga yetsa [pinLockedUntil] gacha blok */
  @Column({ type: 'int', default: 0, select: false })
  failedPinAttempts: number;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  pinLockedUntil: Date | null;

  @Column({ default: true })
  active: boolean;

  /** kuryer: "Ishdaman" — yoqilgan bo'lsagina yangi buyurtma oladi (boshqa rollarda ishlatilmaydi) */
  @Column({ default: false })
  onDuty: boolean;

  @Column({ type: 'timestamptz' })
  createdAt: Date;
}
