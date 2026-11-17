import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sarf materiali (2026-11-18): `ingredients.consumable` (borlari — `false`, admin tovar oynasida yoqadi), "Sarflandi"
 * harakatining qiymati `stock_movements.cost` (borlarida — `null`) va hisobot uchun qisman indeks.
 */
export class Consumables1793900000000 implements MigrationInterface {
  name = 'Consumables1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ingredients" ADD "consumable" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "stock_movements" ADD "cost" bigint`);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_movements_consume_createdAt" ON "stock_movements" ("createdAt") WHERE "kind" = 'consume'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_movements_consume_createdAt"`);
    // "Sarflandi" harakatlari qoldiqni o'zgartirgan — o'chirilmaydi, eski kodda noma'lum tur bo'lib qoladi
    await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN "cost"`);
    await queryRunner.query(`ALTER TABLE "ingredients" DROP COLUMN "consumable"`);
  }
}
