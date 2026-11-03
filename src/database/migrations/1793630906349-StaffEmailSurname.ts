import { MigrationInterface, QueryRunner } from "typeorm";
import { hashPin } from "../../auth/pin";

/** Mavjud adminlarga beriladigan boshlang'ich parol (yangi bazadagi birinchi admin bilan bir xil) — keyin "Profil" da. */
const ADMIN_PASSWORD = '123456789';

/**
 * Xodimga familiya (`surname`); admin va kuryer email va parol bilan kiradi (`login` → `email`). Mavjud ma'lumot
 * saqlanadi: kuryer emaili — `<eski login>@gmail.com`, paroli o'zgarmaydi; email'i yo'q adminlar (avval PIN bilan
 * kirgan) — `admin@gmail.com`, `admin2@gmail.com`, … (band bo'lsa keyingisi), paroli `123456789`. Familiya bo'sh
 * qoladi — admin "Xodimlar" da to'ldiradi.
 */
export class StaffEmailSurname1793630906349 implements MigrationInterface {
    name = 'StaffEmailSurname1793630906349'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "surname" character varying(100) NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "users" ADD "email" character varying(100)`);
        await queryRunner.query(`UPDATE "users" SET "email" = "login" || '@gmail.com' WHERE role = 'courier' AND "login" IS NOT NULL`);

        const admins: { id: string }[] = await queryRunner.query(
            `SELECT id FROM "users" WHERE role = 'admin' AND "email" IS NULL ORDER BY "createdAt", id`,
        );
        if (admins.length > 0) {
            const taken = new Set(
                ((await queryRunner.query(`SELECT "email" FROM "users" WHERE "email" IS NOT NULL`)) as { email: string }[])
                    .map((row) => row.email),
            );
            const pinHash = await hashPin(ADMIN_PASSWORD);
            const candidate = (n: number) => (n === 1 ? 'admin@gmail.com' : `admin${n}@gmail.com`);
            let n = 1;
            for (const { id } of admins) {
                while (taken.has(candidate(n))) n++;
                const email = candidate(n);
                taken.add(email);
                await queryRunner.query(
                    `UPDATE "users" SET "email" = $1, "pinHash" = $2, "failedPinAttempts" = 0, "pinLockedUntil" = NULL WHERE id = $3`,
                    [email, pinHash, id],
                );
            }
        }

        await queryRunner.query(`DROP INDEX "public"."IDX_2d443082eccd5198f95f2a36e2"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "login"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
    }

    /** Orqaga: kuryerga login emailning `@` dan oldingi qismidan; adminlar email'siz qoladi (PIN'ni admin qayta beradi). */
    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "login" character varying(40)`);
        await queryRunner.query(`
            UPDATE "users" SET "login" = left(regexp_replace(split_part("email", '@', 1), '[^a-z0-9._-]', '', 'g'), 40)
            WHERE role = 'courier' AND "email" IS NOT NULL`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "surname"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2d443082eccd5198f95f2a36e2" ON "users" ("login") `);
    }

}
