import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Buyurtma qatorlarining sotuv paytidagi tannarxi (`orders.itemCosts`, admin "Taomlar foydasi" hisoboti). Borlari —
 * `null`: o'tgan sotuvlarning tannarxi noma'lum qoladi (foydalanuvchi qarori, 2026-11-18 — hozirgi narx bilan taxminan
 * to'ldirilmaydi).
 */
export class OrderItemCosts1793880000000 implements MigrationInterface {
  name = 'OrderItemCosts1793880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "itemCosts" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "itemCosts"`);
  }
}
