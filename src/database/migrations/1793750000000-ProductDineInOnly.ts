import { MigrationInterface, QueryRunner } from 'typeorm';

/** Taom faqat zalda beriladimi (choynakdagi choy — olib ketish / dostavkaga yo'q). Borlari — `false`. */
export class ProductDineInOnly1793750000000 implements MigrationInterface {
  name = 'ProductDineInOnly1793750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "dineInOnly" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "dineInOnly"`);
  }
}
