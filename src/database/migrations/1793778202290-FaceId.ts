import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FaceID (2026-11-04): kassir smenani filial terminalida «Kirish» bosib ochadi, «Chiqish» bosib topshiradi. Filial HR
 * tizimi yuborgan o'tishlar (`faceid_events`), Telegram orqali so'ralgan ruxsatlar (`faceid_requests`), kassirning
 * filiallardagi tabel raqamlari (`users.employeeNos`), filialda tekshiruv yoqilganmi (`branches.faceIdRequired` —
 * borlarida o'chiq) va HR oxirgi marta qachon murojaat qilgani (`branches.hrSeenAt`).
 */
export class FaceId1793778202290 implements MigrationInterface {
  name = 'FaceId1793778202290';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "faceid_events" ("id" character varying(40) NOT NULL, "branchId" character varying(40) NOT NULL, "userId" character varying(40) NOT NULL, "employeeNo" integer NOT NULL, "status" character varying(10) NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "device" character varying(100) NOT NULL DEFAULT '', CONSTRAINT "PK_049867a555fe261a8b3d8eb3dc1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_437bc7b84a853f604509c3615a" ON "faceid_events" ("userId", "occurredAt", "branchId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "faceid_requests" ("id" character varying(40) NOT NULL, "userId" character varying(40) NOT NULL, "branchId" character varying(40) NOT NULL, "action" character varying(8) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "decidedAt" TIMESTAMP WITH TIME ZONE, "decidedBy" character varying(40), "messages" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_80987ef169958a1fc8f77298546" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88cad21851c3ef0429290b06ce" ON "faceid_requests" ("userId", "branchId", "createdAt") `,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "employeeNos" jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "branches" ADD "faceIdRequired" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "branches" ADD "hrSeenAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "faceid_events" ADD CONSTRAINT "FK_19be3f88ad5ce3c4ad4028837c9" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "faceid_events" ADD CONSTRAINT "FK_dbe9b8c24a9413dfc39f9c360e8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "faceid_requests" ADD CONSTRAINT "FK_f7596a086e1cbe949d489d29753" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "faceid_requests" ADD CONSTRAINT "FK_c5efa2ec3611bcb66831688303e" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "faceid_requests" ADD CONSTRAINT "FK_bbf8509bc7e4f6dd31c26c816d9" FOREIGN KEY ("decidedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "faceid_requests" DROP CONSTRAINT "FK_bbf8509bc7e4f6dd31c26c816d9"`);
    await queryRunner.query(`ALTER TABLE "faceid_requests" DROP CONSTRAINT "FK_c5efa2ec3611bcb66831688303e"`);
    await queryRunner.query(`ALTER TABLE "faceid_requests" DROP CONSTRAINT "FK_f7596a086e1cbe949d489d29753"`);
    await queryRunner.query(`ALTER TABLE "faceid_events" DROP CONSTRAINT "FK_dbe9b8c24a9413dfc39f9c360e8"`);
    await queryRunner.query(`ALTER TABLE "faceid_events" DROP CONSTRAINT "FK_19be3f88ad5ce3c4ad4028837c9"`);
    await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "hrSeenAt"`);
    await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "faceIdRequired"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "employeeNos"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_88cad21851c3ef0429290b06ce"`);
    await queryRunner.query(`DROP TABLE "faceid_requests"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_437bc7b84a853f604509c3615a"`);
    await queryRunner.query(`DROP TABLE "faceid_events"`);
  }
}
