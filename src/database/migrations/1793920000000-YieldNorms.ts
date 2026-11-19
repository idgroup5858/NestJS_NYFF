import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Norma va pishganda chiqishi (2026-11-19): `ingredients.yieldNorm` (namuna: 64 kg tovuq → 34,5 kg go'sht + 5 kg qanot;
 * kirimda chiqqanlari qo'shiladi) va `ingredients.cookYield` (1000 g xom → 655 g pishgan; retseptdagi son — pishgan).
 * Borlarida ikkalasi `null` — hech narsa o'zgarmaydi.
 */
export class YieldNorms1793920000000 implements MigrationInterface {
  name = 'YieldNorms1793920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ingredients" ADD "yieldNorm" jsonb`);
    await queryRunner.query(`ALTER TABLE "ingredients" ADD "cookYield" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // kirim qatorlaridagi `outputs` qoladi — eski kod uni o'qimaydi
    await queryRunner.query(`ALTER TABLE "ingredients" DROP COLUMN "cookYield"`);
    await queryRunner.query(`ALTER TABLE "ingredients" DROP COLUMN "yieldNorm"`);
  }
}
