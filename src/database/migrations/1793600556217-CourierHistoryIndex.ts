import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Kuryer so'rovlari (qo'lidagilar, bugun yetkazganlari) tarix o'sgani sari sekinlashmasin: `courierId` o'rniga
 * `(courierId, deliveredAt)` va `(courierId, returnedAt)` — yuk testida 1 yillik tarixda `GET /courier/orders` p95 464 ms edi.
 */
export class CourierHistoryIndex1793600556217 implements MigrationInterface {
    name = 'CourierHistoryIndex1793600556217'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_76eaffec5e36a04bbf3bf54914"`);
        await queryRunner.query(`CREATE INDEX "IDX_b4351ad4635cb817f68b9d52c6" ON "orders" ("courierId", "returnedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_d03d4d749dda92d0e46a4b6695" ON "orders" ("courierId", "deliveredAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_d03d4d749dda92d0e46a4b6695"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b4351ad4635cb817f68b9d52c6"`);
        await queryRunner.query(`CREATE INDEX "IDX_76eaffec5e36a04bbf3bf54914" ON "orders" ("courierId") `);
    }

}
