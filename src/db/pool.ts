import pg from "pg";

const { Pool } = pg;

export type Database = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export function createDatabase(databaseUrl: string): Database {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
