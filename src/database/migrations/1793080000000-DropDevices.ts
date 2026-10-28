import { MigrationInterface, QueryRunner } from "typeorm";

/** TV va kiosk endi PINsiz va kalitsiz (filial kirish ekranida tanlanadi) — qurilmalar jadvali kerak emas. */
export class DropDevices1793080000000 implements MigrationInterface {
    name = 'DropDevices1793080000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "devices"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "devices" ("id" character varying(40) NOT NULL, "branchId" character varying(40) NOT NULL, "kind" character varying(10) NOT NULL, "name" character varying(100) NOT NULL, "keyHash" character varying(64), "pairingCode" character varying(6), "pairingExpiresAt" TIMESTAMP WITH TIME ZONE, "pairedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_b1514758245c12daf43486dd1f0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_313d21b29d1e2050533f23ba91" ON "devices" ("keyHash") WHERE "keyHash" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9a147ac7d5fd9c51be826a02c3" ON "devices" ("pairingCode") WHERE "pairingCode" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "devices" ADD CONSTRAINT "FK_0b06457274d1f798765e0f54894" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }
}
