import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AI yordamchi: suhbat tarixi (`ai_messages` — admin paneldagi chat va Telegram chatlari) va start link orqali
 * ulangan Telegram chatlari (`telegram_chats`). Bot tokeni va start link kodlari — `settings` da.
 */
export class AiAssistant1793257582836 implements MigrationInterface {
    name = 'AiAssistant1793257582836'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ai_messages" ("id" character varying(40) NOT NULL, "userId" character varying(40) NOT NULL, "chat" character varying(48) NOT NULL, "role" character varying(8) NOT NULL, "text" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_a390434d4a515ba18a41bc996c2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_aac9a65399c24df8a7fe0165d1" ON "ai_messages" ("userId", "chat", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "telegram_chats" ("chatId" character varying(32) NOT NULL, "userId" character varying(40) NOT NULL, "username" character varying(64), "name" character varying(128) NOT NULL DEFAULT '', "linkedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_1cd0e8e119f110578d356967864" PRIMARY KEY ("chatId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_829423df0cd93c8f29a7d0c227" ON "telegram_chats" ("userId") `);
        await queryRunner.query(`ALTER TABLE "ai_messages" ADD CONSTRAINT "FK_a3dcab02fc150142063a577b77a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "telegram_chats" ADD CONSTRAINT "FK_829423df0cd93c8f29a7d0c227c" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "telegram_chats" DROP CONSTRAINT "FK_829423df0cd93c8f29a7d0c227c"`);
        await queryRunner.query(`ALTER TABLE "ai_messages" DROP CONSTRAINT "FK_a3dcab02fc150142063a577b77a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_829423df0cd93c8f29a7d0c227"`);
        await queryRunner.query(`DROP TABLE "telegram_chats"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aac9a65399c24df8a7fe0165d1"`);
        await queryRunner.query(`DROP TABLE "ai_messages"`);
    }

}
