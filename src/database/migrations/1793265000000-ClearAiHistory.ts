import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AI suhbat tarixi endi saqlanmaydi (2026-10-29): web chat har ochilganda yangidan, bazada har chatda faqat AI xotirasi
 * (oxirgi 20 ta xabar). Shu kungacha yig'ilgan suhbatlar bir marta o'chiriladi. Ulangan Telegram chatlari qoladi.
 */
export class ClearAiHistory1793265000000 implements MigrationInterface {
    name = 'ClearAiHistory1793265000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "ai_messages"`);
    }

    public async down(): Promise<void> {
        // o'chirilgan xabarlar qaytmaydi
    }

}
