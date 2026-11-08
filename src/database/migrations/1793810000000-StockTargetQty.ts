import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Norma (2026-11-08): "To'ldirish" qoldiqni shu darajagacha yetkazadi (`stock.targetQty`, asosiy birlikda). 0 —
 * yozilmagan: chegara × 2, chegara ham yo'q bo'lsa — 10 birlik (web hisoblaydi).
 */
export class StockTargetQty1793810000000 implements MigrationInterface {
  name = 'StockTargetQty1793810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock" ADD "targetQty" integer NOT NULL DEFAULT '0'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock" DROP COLUMN "targetQty"`);
  }
}
