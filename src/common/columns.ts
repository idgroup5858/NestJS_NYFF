import { ValueTransformer } from 'typeorm';

/** Postgres `bigint` matn bo'lib qaytadi — pul summalari JS'da son sifatida ishlatiladi. */
export const bigintNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/** Id ustunlari: frontend id'lari (`br_chilonzor`, `ord_3f2a…`) shu uzunlikka sig'adi. */
export const ID_LENGTH = 40;
