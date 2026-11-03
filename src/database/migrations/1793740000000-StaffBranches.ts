import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bitta xodim bir nechta filialda ishlay oladi (2026-11-04): `users.branchId` → `users.branchIds` (jsonb ro'yxat,
 * borlari — bitta filialli ro'yxat). Kassirda bir vaqtda faqat **bitta** ochiq smena (avval — har filialda bittadan):
 * yangi unique indeks `shifts ("cashierId") WHERE "closedAt" IS NULL`.
 *
 * Indeksdan oldin: bir kassirning bir nechta ochiq smenasi bo'lsa (admin smena ochiq turganda kassir filialini
 * almashtirgan — eski filialdagi smena hech kim yopolmaydigan bo'lib qolgan), eng yangisidan boshqalari yopiladi —
 * `closedAt` = eng yangisi ochilgan vaqt (kassir o'shanda boshqa filialga o'tgan). Migratsiya server ishga tushganda
 * bajariladi — xato bilan to'xtamasin.
 */
export class StaffBranches1793740000000 implements MigrationInterface {
  name = 'StaffBranches1793740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "branchIds" jsonb NOT NULL DEFAULT '[]'`);
    await queryRunner.query(
      `UPDATE "users" SET "branchIds" = jsonb_build_array("branchId") WHERE "branchId" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_246426dfd001466a1d5e47322f4"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "branchId"`);

    await queryRunner.query(`
      UPDATE "shifts" s SET "closedAt" = latest."openedAt"
      FROM (
        SELECT DISTINCT ON ("cashierId") "cashierId", "id", "openedAt"
        FROM "shifts" WHERE "closedAt" IS NULL
        ORDER BY "cashierId", "openedAt" DESC, "id" DESC
      ) latest
      WHERE s."cashierId" = latest."cashierId" AND s."closedAt" IS NULL AND s."id" <> latest."id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b32848159ddacd52403d8836e5"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6b7c776e12aa08d5a199b7b086" ON "shifts" ("cashierId") WHERE "closedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_6b7c776e12aa08d5a199b7b086"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b32848159ddacd52403d8836e5" ON "shifts" ("cashierId", "branchId") WHERE "closedAt" IS NULL`,
    );
    // bir nechta filialli xodim — birinchisida qoladi
    await queryRunner.query(`ALTER TABLE "users" ADD "branchId" character varying(40)`);
    await queryRunner.query(`UPDATE "users" SET "branchId" = "branchIds"->>0`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_246426dfd001466a1d5e47322f4" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "branchIds"`);
  }
}
