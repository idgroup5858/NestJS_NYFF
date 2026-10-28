import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1793059136458 implements MigrationInterface {
    name = 'Init1793059136458'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "branches" ("id" character varying(40) NOT NULL, "name" character varying(100) NOT NULL, "address" character varying(255) NOT NULL DEFAULT '', "phone" character varying(30) NOT NULL DEFAULT '', "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "location" jsonb, "deliveryZone" jsonb NOT NULL DEFAULT '[]', "deliveryFee" bigint NOT NULL DEFAULT '0', "fallbackBranchId" character varying(40), "onlineEnabled" boolean NOT NULL DEFAULT true, "workHours" jsonb, CONSTRAINT "PK_7f37d3b42defea97f1df0d19535" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "warehouses" ("id" character varying(40) NOT NULL, "name" character varying(100) NOT NULL, "kind" character varying(10) NOT NULL, "branchId" character varying(40), CONSTRAINT "PK_56ae21ee2432b2270b48867e4be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_301b6e12e4ffe7fc38f2e22170" ON "warehouses" ("branchId") `);
        await queryRunner.query(`CREATE TABLE "devices" ("id" character varying(40) NOT NULL, "branchId" character varying(40) NOT NULL, "kind" character varying(10) NOT NULL, "name" character varying(100) NOT NULL, "keyHash" character varying(64), "pairingCode" character varying(6), "pairingExpiresAt" TIMESTAMP WITH TIME ZONE, "pairedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_b1514758245c12daf43486dd1f0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_313d21b29d1e2050533f23ba91" ON "devices" ("keyHash") WHERE "keyHash" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9a147ac7d5fd9c51be826a02c3" ON "devices" ("pairingCode") WHERE "pairingCode" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "expenses" ("id" character varying(40) NOT NULL, "branchId" character varying(40) NOT NULL, "kind" character varying(16) NOT NULL, "amount" bigint NOT NULL, "date" date NOT NULL, "note" text NOT NULL DEFAULT '', "createdBy" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_94c3ceb17e3140abc9282c20610" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6cfba211668143e44ba7a6ef87" ON "expenses" ("branchId", "date") `);
        await queryRunner.query(`CREATE TABLE "categories" ("id" character varying(40) NOT NULL, "name" jsonb NOT NULL, "image" character varying(255) NOT NULL DEFAULT '', "icon" character varying(255) NOT NULL DEFAULT '', "sortOrder" integer NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "products" ("id" character varying(40) NOT NULL, "categoryId" character varying(40) NOT NULL, "name" jsonb NOT NULL, "image" character varying(255) NOT NULL DEFAULT '', "recipe" jsonb NOT NULL, "sortOrder" integer NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ff56834e735fa78a15d0cf2192" ON "products" ("categoryId") `);
        await queryRunner.query(`CREATE TABLE "branch_prices" ("branchId" character varying(40) NOT NULL, "productId" character varying(40) NOT NULL, "price" bigint NOT NULL, "available" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c2daa452b02ebbc37b8aa177cfa" PRIMARY KEY ("branchId", "productId"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" character varying(40) NOT NULL, "branchId" character varying(40) NOT NULL, "number" integer NOT NULL, "type" character varying(10) NOT NULL, "source" character varying(10) NOT NULL, "items" jsonb NOT NULL, "note" text NOT NULL DEFAULT '', "total" bigint NOT NULL, "payment" character varying(10), "split" jsonb, "online" jsonb, "status" character varying(10) NOT NULL, "cashierId" character varying(40), "shiftId" character varying(40), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "preparingAt" TIMESTAMP WITH TIME ZONE, "readyAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelledBy" character varying(40), "cancelReason" character varying(16), "routedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "transferCount" integer NOT NULL DEFAULT '0', "fromBranchId" character varying(40), "trackingTokenHash" character varying(64), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a8210c072acef6e5a6135e8e97" ON "orders" ("shiftId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1f4b9818a08b822a31493fdee9" ON "orders" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_cb2965601b184d1ee4a3ac8051" ON "orders" ("branchId", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_8736d7c044929b8c3d4d63a763" ON "orders" ("branchId", "status") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" character varying(40) NOT NULL, "name" character varying(100) NOT NULL, "role" character varying(16) NOT NULL, "branchId" character varying(40), "pinHash" character varying(100) NOT NULL, "failedPinAttempts" integer NOT NULL DEFAULT '0', "pinLockedUntil" TIMESTAMP WITH TIME ZONE, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "shifts" ("id" character varying(40) NOT NULL, "branchId" character varying(40) NOT NULL, "cashierId" character varying(40) NOT NULL, "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "closedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_84d692e367e4d6cdf045828768c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_00a02c1692ead17810900390f9" ON "shifts" ("branchId", "openedAt") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b32848159ddacd52403d8836e5" ON "shifts" ("cashierId", "branchId") WHERE "closedAt" IS NULL`);
        await queryRunner.query(`CREATE TABLE "ingredients" ("id" character varying(40) NOT NULL, "name" jsonb NOT NULL, "group" character varying(20) NOT NULL, "unit" character varying(4) NOT NULL, "lastPrice" bigint, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_9240185c8a5507251c9f15e0649" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "purchases" ("id" character varying(40) NOT NULL, "number" integer NOT NULL, "warehouseId" character varying(40) NOT NULL, "items" jsonb NOT NULL, "note" text NOT NULL DEFAULT '', "status" character varying(10) NOT NULL, "createdBy" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "decidedBy" character varying(40), "decidedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1d55032f37a34c6eceacbbca6b8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_36cd9508061bebb74fb3e1a9c7" ON "purchases" ("status") `);
        await queryRunner.query(`CREATE TABLE "stock" ("warehouseId" character varying(40) NOT NULL, "ingredientId" character varying(40) NOT NULL, "qty" integer NOT NULL DEFAULT '0', "minQty" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_245dc8292b07de606d4350691c6" PRIMARY KEY ("warehouseId", "ingredientId"))`);
        await queryRunner.query(`CREATE TABLE "stock_movements" ("id" character varying(40) NOT NULL, "warehouseId" character varying(40) NOT NULL, "ingredientId" character varying(40) NOT NULL, "qty" integer NOT NULL, "kind" character varying(16) NOT NULL, "refId" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_57a26b190618550d8e65fb860e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e0583ca98ea6cf1a2461c246a8" ON "stock_movements" ("refId") `);
        await queryRunner.query(`CREATE INDEX "IDX_dc8906450beaff9a18e537dc4f" ON "stock_movements" ("warehouseId", "ingredientId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "transfers" ("id" character varying(40) NOT NULL, "number" integer NOT NULL, "fromWarehouseId" character varying(40) NOT NULL, "toWarehouseId" character varying(40) NOT NULL, "items" jsonb NOT NULL, "note" text NOT NULL DEFAULT '', "createdBy" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_f712e908b465e0085b4408cabc3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "counters" ("key" character varying(120) NOT NULL, "value" integer NOT NULL, CONSTRAINT "PK_c6c33328f872db2d0aaabbacbc8" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "settings" ("key" character varying(64) NOT NULL, "value" text NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c8639b7626fa94ba8265628f214" PRIMARY KEY ("key"))`);
        await queryRunner.query(`ALTER TABLE "branches" ADD CONSTRAINT "FK_599136f7786d973df6aad635b42" FOREIGN KEY ("fallbackBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "warehouses" ADD CONSTRAINT "FK_301b6e12e4ffe7fc38f2e22170d" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "devices" ADD CONSTRAINT "FK_0b06457274d1f798765e0f54894" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_eed45f691864a80afbd9e2178ce" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_ff56834e735fa78a15d0cf21926" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "branch_prices" ADD CONSTRAINT "FK_7f13999024a500f7ca1fb72240c" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "branch_prices" ADD CONSTRAINT "FK_824685e73c4c05132e74e093acf" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_873d9661d948ee484150cf4c73d" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_246426dfd001466a1d5e47322f4" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shifts" ADD CONSTRAINT "FK_f810ae885d5cb2d5748a407a148" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "shifts" ADD CONSTRAINT "FK_7ca1fc97756fc9550bb3fcdf501" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchases" ADD CONSTRAINT "FK_5cbca7ccb91c4c9a6027358caf8" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock" ADD CONSTRAINT "FK_2cc5be32db1259f44995d0100aa" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock" ADD CONSTRAINT "FK_7d38258a75e111d1941000aaff8" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stock" DROP CONSTRAINT "FK_7d38258a75e111d1941000aaff8"`);
        await queryRunner.query(`ALTER TABLE "stock" DROP CONSTRAINT "FK_2cc5be32db1259f44995d0100aa"`);
        await queryRunner.query(`ALTER TABLE "purchases" DROP CONSTRAINT "FK_5cbca7ccb91c4c9a6027358caf8"`);
        await queryRunner.query(`ALTER TABLE "shifts" DROP CONSTRAINT "FK_7ca1fc97756fc9550bb3fcdf501"`);
        await queryRunner.query(`ALTER TABLE "shifts" DROP CONSTRAINT "FK_f810ae885d5cb2d5748a407a148"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_246426dfd001466a1d5e47322f4"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_873d9661d948ee484150cf4c73d"`);
        await queryRunner.query(`ALTER TABLE "branch_prices" DROP CONSTRAINT "FK_824685e73c4c05132e74e093acf"`);
        await queryRunner.query(`ALTER TABLE "branch_prices" DROP CONSTRAINT "FK_7f13999024a500f7ca1fb72240c"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_ff56834e735fa78a15d0cf21926"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_eed45f691864a80afbd9e2178ce"`);
        await queryRunner.query(`ALTER TABLE "devices" DROP CONSTRAINT "FK_0b06457274d1f798765e0f54894"`);
        await queryRunner.query(`ALTER TABLE "warehouses" DROP CONSTRAINT "FK_301b6e12e4ffe7fc38f2e22170d"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP CONSTRAINT "FK_599136f7786d973df6aad635b42"`);
        await queryRunner.query(`DROP TABLE "settings"`);
        await queryRunner.query(`DROP TABLE "counters"`);
        await queryRunner.query(`DROP TABLE "transfers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc8906450beaff9a18e537dc4f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e0583ca98ea6cf1a2461c246a8"`);
        await queryRunner.query(`DROP TABLE "stock_movements"`);
        await queryRunner.query(`DROP TABLE "stock"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36cd9508061bebb74fb3e1a9c7"`);
        await queryRunner.query(`DROP TABLE "purchases"`);
        await queryRunner.query(`DROP TABLE "ingredients"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b32848159ddacd52403d8836e5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_00a02c1692ead17810900390f9"`);
        await queryRunner.query(`DROP TABLE "shifts"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8736d7c044929b8c3d4d63a763"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cb2965601b184d1ee4a3ac8051"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1f4b9818a08b822a31493fdee9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a8210c072acef6e5a6135e8e97"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TABLE "branch_prices"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ff56834e735fa78a15d0cf2192"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "categories"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6cfba211668143e44ba7a6ef87"`);
        await queryRunner.query(`DROP TABLE "expenses"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9a147ac7d5fd9c51be826a02c3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_313d21b29d1e2050533f23ba91"`);
        await queryRunner.query(`DROP TABLE "devices"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_301b6e12e4ffe7fc38f2e22170"`);
        await queryRunner.query(`DROP TABLE "warehouses"`);
        await queryRunner.query(`DROP TABLE "branches"`);
    }

}
