import nextEnv from "@next/env";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { openDatabase, resolveDatabaseFile } from "./sqlite.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseFile = resolveDatabaseFile();
const database = openDatabase(databaseFile);

try {
  database.exec(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at text not null
    )
  `);

  const migrationDir = path.join(process.cwd(), "database", "migrations");
  const files = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = database.prepare("select 1 from schema_migrations where version = ?").get(file);
    if (applied) continue;
    const sql = await readFile(path.join(migrationDir, file), "utf8");
    database.exec("begin immediate");
    try {
      database.exec(sql);
      database
        .prepare("insert into schema_migrations (version, applied_at) values (?, ?)")
        .run(file, new Date().toISOString());
      database.exec("commit");
      console.log(`已应用数据库迁移：${file}`);
    } catch (error) {
      database.exec("rollback");
      throw error;
    }
  }
  console.log(`SQLite 数据库结构已是最新：${databaseFile}`);
} finally {
  database.close();
}
