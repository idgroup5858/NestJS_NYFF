// TypeORM CLI uchun (migration:generate / migration:run).
import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { dataSourceOptions, dbConnectionFromEnv } from './db-config';

config();

export default new DataSource(dataSourceOptions(dbConnectionFromEnv()));
