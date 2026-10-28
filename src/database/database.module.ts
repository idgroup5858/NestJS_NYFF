import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions, dbConnectionFromEnv, ensureDatabase } from './db-config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: async () => {
        const db = dbConnectionFromEnv();
        await ensureDatabase(db);
        return { ...dataSourceOptions(db), migrationsRun: true };
      },
    }),
  ],
})
export class DatabaseModule {}
