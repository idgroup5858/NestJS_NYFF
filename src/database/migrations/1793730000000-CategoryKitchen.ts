import { MigrationInterface, QueryRunner } from 'typeorm';

/** Kategoriya taomlari oshxona chekiga chiqadimi (`false` — ichimliklar: kassir o'zi beradi). Borlari — `true`. */
export class CategoryKitchen1793730000000 implements MigrationInterface {
  name = 'CategoryKitchen1793730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" ADD "kitchen" boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "kitchen"`);
  }
}
