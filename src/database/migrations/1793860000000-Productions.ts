import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tayyorlash (2026-11-18): "Tayyorlash №N" hujjati — markaziy omborda go'sht, tuxum, yog' → katlet. Tayyor mahsulot va
 * miqdori, sarflanganlar (`items`), tannarx, kim va qachon. Harakatlar (`production`) — `stock_movements` da, `refId` —
 * shu hujjat (`kind` — `varchar(16)`, yangi qiymat uchun sxema o'zgarmaydi).
 */
export class Productions1793860000000 implements MigrationInterface {
  name = 'Productions1793860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "productions" ("id" character varying(40) NOT NULL, "number" integer NOT NULL, "warehouseId" character varying(40) NOT NULL, "ingredientId" character varying(40) NOT NULL, "qty" double precision NOT NULL, "items" jsonb NOT NULL, "cost" bigint, "note" text NOT NULL DEFAULT '', "createdBy" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_395fda0b6f26cb5fd9a2aa6315c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_42a7d92fe4b616c3514b1d06a7" ON "productions" ("ingredientId") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_42a7d92fe4b616c3514b1d06a7"`);
    await queryRunner.query(`DROP TABLE "productions"`);
  }
}
