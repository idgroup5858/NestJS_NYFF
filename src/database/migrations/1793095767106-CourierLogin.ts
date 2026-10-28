import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Kuryer login va parol bilan kiradi (ismlar ro'yxatisiz). Mavjud kuryerlarga login ismidan beriladi (kichik lotin
 * harflari va raqamlar; takrorlansa — oxiriga raqam, ism lotincha bo'lmasa — `kuryer`), paroli — eski PIN'i. Admin
 * keyin "Xodimlar" da almashtiradi.
 */
export class CourierLogin1793095767106 implements MigrationInterface {
    name = 'CourierLogin1793095767106'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "login" character varying(40)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2d443082eccd5198f95f2a36e2" ON "users" ("login") `);
        await queryRunner.query(`
            UPDATE "users" u SET "login" = CASE WHEN n.rn = 1 THEN n.base ELSE n.base || n.rn END
            FROM (
                SELECT id, base, row_number() OVER (PARTITION BY base ORDER BY "createdAt", id) AS rn
                FROM (
                    SELECT id, "createdAt",
                        COALESCE(NULLIF(left(regexp_replace(lower(name), '[^a-z0-9]', '', 'g'), 30), ''), 'kuryer') AS base
                    FROM "users" WHERE role = 'courier'
                ) b
            ) n
            WHERE u.id = n.id`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_2d443082eccd5198f95f2a36e2"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "login"`);
    }

}
