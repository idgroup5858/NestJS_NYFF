import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Qadoq (2026-11-04): ombor mahsulotining qadoq hajmi (`ingredients.packSize`, asosiy birlikda — 600 g lik ketchup),
 * borlarida qadoqsiz. Kirim va ko'chirish qatorlariga yozilgan paytdagi hajm (`items[].packSize`) — eskilariga `null`.
 */
export class IngredientPackSize1793790000000 implements MigrationInterface {
  name = 'IngredientPackSize1793790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ingredients" ADD "packSize" integer`);
    for (const table of ['purchases', 'transfers']) {
      await queryRunner.query(
        `UPDATE "${table}" SET "items" = (
           SELECT jsonb_agg(e.item || '{"packSize": null}'::jsonb ORDER BY e.pos)
           FROM jsonb_array_elements("items") WITH ORDINALITY AS e(item, pos)
         ) WHERE jsonb_array_length("items") > 0`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['purchases', 'transfers']) {
      await queryRunner.query(
        `UPDATE "${table}" SET "items" = (
           SELECT jsonb_agg(e.item - 'packSize' ORDER BY e.pos)
           FROM jsonb_array_elements("items") WITH ORDINALITY AS e(item, pos)
         ) WHERE jsonb_array_length("items") > 0`,
      );
    }
    await queryRunner.query(`ALTER TABLE "ingredients" DROP COLUMN "packSize"`);
  }
}
