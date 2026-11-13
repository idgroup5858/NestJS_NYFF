import { MigrationInterface, QueryRunner } from 'typeorm';

/** Filialda kassir ham "Tayyor" / "Qaytarish" bosadimi (oshpaz yordamchisi yo'q filial). Borlari — `false`. */
export class CashierMarksReady1793840000000 implements MigrationInterface {
  name = 'CashierMarksReady1793840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" ADD "cashierMarksReady" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "cashierMarksReady"`);
  }
}
