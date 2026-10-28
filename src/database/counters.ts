import { Column, Entity, EntityManager, PrimaryColumn } from 'typeorm';

/** Ketma-ket raqamlar: `order:<filial>:<sana>` (har filialda har kuni 1 dan), `purchase`, `transfer`. */
@Entity('counters')
export class Counter {
  @PrimaryColumn({ type: 'varchar', length: 120 })
  key: string;

  @Column({ type: 'int' })
  value: number;
}

/**
 * Hisoblagichning keyingi qiymati (1 dan). Bitta SQL — qator tranzaksiya oxirigacha qulflanadi, shuning uchun bir
 * vaqtda kelgan ikki buyurtma bir xil raqam olmaydi; tranzaksiya bekor bo'lsa raqam ham qaytadi.
 */
export async function nextCounter(em: EntityManager, key: string): Promise<number> {
  const rows: { value: number }[] = await em.query(
    `INSERT INTO counters ("key", "value") VALUES ($1, 1)
     ON CONFLICT ("key") DO UPDATE SET "value" = counters."value" + 1
     RETURNING "value"`,
    [key],
  );
  return rows[0].value;
}
