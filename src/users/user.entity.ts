import { Column, Entity, Index, PrimaryColumn, Raw } from 'typeorm';
import { ID_LENGTH } from '../common/columns';
import type { Role } from '../common/enums';

/** Ekrandagi ism: "Ism Familiya" (familiya bo'sh bo'lsa — faqat ism). */
export const fullName = (person: { name: string; surname: string }): string =>
  [person.name, person.surname].filter(Boolean).join(' ');

/** `find({ where: { branchIds: worksAt(id) } })` — shu filialda ishlaydigan xodimlar (`branchIds` ichida bor). */
export const worksAt = (branchId: string) =>
  Raw((column) => `${column} @> CAST(:worksAtBranch AS jsonb)`, { worksAtBranch: JSON.stringify([branchId]) });

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

  /**
   * Kassir va oshpaz yordamchisi ishlaydigan filiallar (kamida bittasi; 2026-11-04 dan bir nechta bo'lishi mumkin — PIN
   * bilan kirganda kassa turgan filial tanlanadi, u tokenga yoziladi). Admin, ta'minotchi va kuryer — `[]`. FK yo'q:
   * filial o'chirishda `BranchesService.remove` tekshiradi.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  branchIds: string[];

  /**
   * Kassirning tabel raqamlari (FaceID, 2026-11-04): filial id → filial HR tizimidagi / terminaldagi `employeeNo`. HR
   * har filialda alohida o'rnatiladi — raqam ham filialga xos. Faqat kassirda, faqat [branchIds] dagi filiallar uchun;
   * bir filialda bitta raqam — bitta xodim.
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  employeeNos: Record<string, number>;

  /**
   * Admin va kuryer (`usesPassword`): kirish emaili (kichik harfda, takrorlanmaydi); parol xeshi — [pinHash] da. PIN
   * bilan kiradiganlarda `null`.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

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
