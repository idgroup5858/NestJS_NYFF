import { MigrationInterface, QueryRunner } from 'typeorm';

/** Filial sotuvi markaziy ombordan ayriladimi (markazga juda yaqin filial). Borlari — `false`. */
export class StockFromCentral1793850000000 implements MigrationInterface {
  name = 'StockFromCentral1793850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" ADD "stockFromCentral" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "stockFromCentral"`);
  }
}
