import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Tizim sozlamalari (kalit → qiymat): masalan `.env` da berilmagan JWT kaliti. */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
