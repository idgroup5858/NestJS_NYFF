import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mobil ilovada karta bilan to'lov (2026-11-18): `mobile_payments` — bank sahifasi ochilgan to'lovlar; buyurtma
 * to'langandan keyin yaratiladi. Mavjud jadvallarga tegilmaydi.
 */
export class MobilePayments1793910000000 implements MigrationInterface {
  name = 'MobilePayments1793910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "mobile_payments" (
        "id" character varying(40) NOT NULL,
        "status" character varying(10) NOT NULL,
        "branchId" character varying(40) NOT NULL,
        "type" character varying(10) NOT NULL,
        "lines" jsonb NOT NULL,
        "items" jsonb NOT NULL,
        "note" text NOT NULL DEFAULT '',
        "online" jsonb NOT NULL,
        "deliveryFee" bigint,
        "total" bigint NOT NULL,
        "trackingTokenHash" character varying(64) NOT NULL,
        "paymentUrl" text,
        "transactionId" character varying(64),
        "orderId" character varying(40),
        "error" character varying(40),
        "bank" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "paidAt" TIMESTAMP WITH TIME ZONE,
        "checkedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_268b83b2741fb6e560dc811efe5" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4911c89347ce8eb239ff72f17" ON "mobile_payments" ("status", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_a4911c89347ce8eb239ff72f17"`);
    await queryRunner.query(`DROP TABLE "mobile_payments"`);
  }
}
