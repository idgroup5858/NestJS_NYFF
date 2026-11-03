import { MigrationInterface, QueryRunner } from 'typeorm';

/** Offline kassadan internet qaytgach yuborilgan buyurtma — markazga yetib kelgan vaqti (oddiy buyurtmada `null`). */
export class OrderSyncedAt1793720000000 implements MigrationInterface {
  name = 'OrderSyncedAt1793720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "syncedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "syncedAt"`);
  }
}
