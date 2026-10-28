import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Taom narxi barcha filiallarda bir xil — `products.price`; filial bo'yicha faqat "vaqtincha sotilmaydi" belgisi qoladi
 * (`products.unavailableBranchIds`). Narx birinchi ochilgan filialdagi narxdan olinadi; narxi yo'q yoki "sotuvda yo'q"
 * bo'lgan filiallar ro'yxatga yoziladi (hech qayerda narxi bo'lmagan taom — narxi 0, hamma filialda sotilmaydi).
 */
export class SingleMenuPrice1793216335897 implements MigrationInterface {
    name = 'SingleMenuPrice1793216335897'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" ADD "price" bigint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "products" ADD "unavailableBranchIds" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`
            UPDATE "products" p SET "price" = s."price"
            FROM (
                SELECT DISTINCT ON (bp."productId") bp."productId", bp."price"
                FROM "branch_prices" bp JOIN "branches" b ON b."id" = bp."branchId"
                ORDER BY bp."productId", b."createdAt", b."id"
            ) s
            WHERE p."id" = s."productId"`);
        await queryRunner.query(`
            UPDATE "products" p SET "unavailableBranchIds" = COALESCE((
                SELECT jsonb_agg(b."id" ORDER BY b."createdAt", b."id") FROM "branches" b
                WHERE NOT EXISTS (
                    SELECT 1 FROM "branch_prices" bp
                    WHERE bp."productId" = p."id" AND bp."branchId" = b."id" AND bp."available"
                )
            ), '[]')`);
        await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "price" DROP DEFAULT`);
        await queryRunner.query(`DROP TABLE "branch_prices"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "branch_prices" ("branchId" character varying(40) NOT NULL, "productId" character varying(40) NOT NULL, "price" bigint NOT NULL, "available" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c2daa452b02ebbc37b8aa177cfa" PRIMARY KEY ("branchId", "productId"))`);
        await queryRunner.query(`ALTER TABLE "branch_prices" ADD CONSTRAINT "FK_7f13999024a500f7ca1fb72240c" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "branch_prices" ADD CONSTRAINT "FK_824685e73c4c05132e74e093acf" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`
            INSERT INTO "branch_prices" ("branchId", "productId", "price", "available")
            SELECT b."id", p."id", p."price", NOT (p."unavailableBranchIds" ? b."id")
            FROM "products" p CROSS JOIN "branches" b
            WHERE p."price" > 0`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "unavailableBranchIds"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "price"`);
    }

}
