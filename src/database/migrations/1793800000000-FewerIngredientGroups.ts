import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ombor guruhlari qisqardi (2026-11-08): baliq, sut, mevalar, muzlatilgan, bakaleya, shirinlik va qadoq guruhlari
 * olib tashlandi — ulardagi mahsulotlar `other` ga o'tadi (bo'lmasa web sahifalarda hech qaysi guruhga tushmay yo'qoladi).
 * Qaytarib bo'lmaydi: qaysi mahsulot qaysi guruhda bo'lgani saqlanmaydi.
 */
export class FewerIngredientGroups1793800000000 implements MigrationInterface {
  name = 'FewerIngredientGroups1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "ingredients" SET "group" = 'other'
       WHERE "group" IN ('seafood', 'dairy', 'fruits', 'frozen', 'grocery', 'sweets', 'packaging')`,
    );
  }

  public async down(): Promise<void> {
    // eski guruhlar saqlanmagan — mahsulotlar `other` da qoladi
  }
}
