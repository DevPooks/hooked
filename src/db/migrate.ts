import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "../config/env.js";
import { createDatabase, type Database } from "./pool.js";

export async function migrate(database: Database, directory = path.resolve(process.cwd(), "migrations")): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = await database.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name = $1) AS exists", [file]);
    if (applied.rows[0]?.exists === true) continue;
    const sql = await readFile(path.join(directory, file), "utf8");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = createDatabase(loadConfig().databaseUrl);
  migrate(database)
    .then(() => console.log("Database migrations applied."))
    .finally(() => database.end())
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
