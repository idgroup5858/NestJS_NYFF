import { MigrationInterface, QueryRunner } from "typeorm";

/** "Yaqinda tayyor bo'lganlar" (TV, oshxona, kassa) tarix o'sgani sari sekinlashmasin: `orders (branchId, readyAt)`. */
export class ReadyAtIndex1793595275423 implements MigrationInterface {
    name = 'ReadyAtIndex1793595275423'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "IDX_29a703c426fa520b773a9af928" ON "orders" ("branchId", "readyAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_29a703c426fa520b773a9af928"`);
    }

}
