import { MigrationInterface, QueryRunner } from "typeorm";

/** Kuryer: buyurtmada kuryer bosqichlari va yetkazish navbati, mobil dostavkaning hudud narxi; xodimda "Ishdaman". */
export class Courier1793088593408 implements MigrationInterface {
    name = 'Courier1793088593408'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD "deliveryFee" bigint`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "courierId" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "takenAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "departedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "deliveredAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "returnedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "returnReason" character varying(16)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "returnNote" text NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "courierSeq" integer`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "courierLegKm" double precision`);
        await queryRunner.query(`ALTER TABLE "users" ADD "onDuty" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE INDEX "IDX_76eaffec5e36a04bbf3bf54914" ON "orders" ("courierId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_76eaffec5e36a04bbf3bf54914"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "onDuty"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "courierLegKm"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "courierSeq"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "returnNote"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "returnReason"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "returnedAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "deliveredAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "departedAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "takenAt"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "courierId"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "deliveryFee"`);
    }

}
