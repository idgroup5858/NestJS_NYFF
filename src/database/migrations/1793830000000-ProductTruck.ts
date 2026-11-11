import { MigrationInterface, QueryRunner } from 'typeorm';

/** Taom truck chekiga chiqadimi (uchinchi printer — "NYFF Offline"da). Borlari — `false`. */
export class ProductTruck1793830000000 implements MigrationInterface {
  name = 'ProductTruck1793830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "truck" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "truck"`);
  }
}
