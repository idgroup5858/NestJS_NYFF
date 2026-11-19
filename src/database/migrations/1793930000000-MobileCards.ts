import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bog'langan kartalar (2026-11-19): `mobile_cards` — telefonga bog'langan karta (bank tokeni faqat shu yerda) va
 * `mobile_payments.cardId` — saqlangan kartadan to'langanda qaysi karta (bank sahifasi orqali to'lovda `null`).
 */
export class MobileCards1793930000000 implements MigrationInterface {
  name = 'MobileCards1793930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "mobile_cards" ("id" character varying(40) NOT NULL, "clientKeyHash" character varying(64) NOT NULL, "status" character varying(10) NOT NULL, "cardToken" character varying(64), "maskedPan" character varying(32), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "boundAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_dc6f3ee0e53de8de0a8277239dd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ec1511b8d506b20c92dad1c98c" ON "mobile_cards" ("clientKeyHash", "status") `);
    await queryRunner.query(`ALTER TABLE "mobile_payments" ADD "cardId" character varying(40)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mobile_payments" DROP COLUMN "cardId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ec1511b8d506b20c92dad1c98c"`);
    await queryRunner.query(`DROP TABLE "mobile_cards"`);
  }
}
