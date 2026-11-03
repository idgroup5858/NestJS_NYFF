import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Taom oshxona chekiga chiqadimi (`false` — tayyor ichimlik: kola, suv — kassir o'zi beradi; choy, qahva — chiqadi).
 * Borlari — `true`. Belgi avval kategoriyada edi (hech qayerga chiqmagan) — test bazasida qolgan bo'lsa olib tashlanadi.
 */
export class ProductKitchen1793730000000 implements MigrationInterface {
  name = 'ProductKitchen1793730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "kitchen" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN IF EXISTS "kitchen"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "kitchen"`);
  }
}
