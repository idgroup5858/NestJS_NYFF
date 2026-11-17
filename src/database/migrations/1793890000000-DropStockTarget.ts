import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Norma olib tashlandi (2026-11-18): markaziy omborda uni chegara deb o'ylab to'ldirishgan — foydalanuvchi: "norma
 * bo'limini olib tashlaylik, o'chib ketaversin, chegara qolaversin". Yozilgan normalar o'chadi; chegara o'zgarmaydi.
 */
export class DropStockTarget1793890000000 implements MigrationInterface {
  name = 'DropStockTarget1793890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock" DROP COLUMN "targetQty"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stock" ADD "targetQty" integer NOT NULL DEFAULT '0'`);
  }
}
