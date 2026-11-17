import { MigrationInterface, QueryRunner } from 'typeorm';

/** Chiqim ombor mahsulotiga to'lov bo'lishi mumkin (`kind: 'ingredient'`): qaysi mahsulot. Borlari — `null`. */
export class ExpenseIngredient1793870000000 implements MigrationInterface {
  name = 'ExpenseIngredient1793870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "expenses" ADD "ingredientId" character varying(40)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "expenses" WHERE "kind" = 'ingredient'`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "ingredientId"`);
  }
}
