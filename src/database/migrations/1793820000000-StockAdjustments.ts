import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Qoldiqni 0 ga tushirish (2026-11-10): "Tuzatish" hujjati — raqami, ombor, kim va qachon. Harakatlar (`adjust`) —
 * `stock_movements` da, `refId` — shu hujjat.
 */
export class StockAdjustments1793820000000 implements MigrationInterface {
  name = 'StockAdjustments1793820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stock_adjustments" ("id" character varying(40) NOT NULL, "number" integer NOT NULL, "warehouseId" character varying(40) NOT NULL, "createdBy" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_7dc03d92f242dd489d33b80d063" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stock_adjustments"`);
  }
}
