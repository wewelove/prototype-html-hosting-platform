import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** 与应用保持一致的数据库文件位置解析规则。 */
export function resolveDatabaseFile() {
  const dataDir = process.env.DATA_DIR ?? "/data";
  return process.env.DATABASE_FILE ?? path.join(dataDir, "axhub.sqlite3");
}

/**
 * 打开 SQLite 数据库并注册 gen_random_uuid()/now() 自定义函数，
 * 迁移脚本、初始化脚本和应用使用同一套表结构与默认值表达式。
 */
export function openDatabase(databaseFile = resolveDatabaseFile()) {
  mkdirSync(path.dirname(databaseFile), { recursive: true });
  const database = new DatabaseSync(databaseFile, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
  database.exec("pragma journal_mode = WAL");
  database.exec("pragma synchronous = NORMAL");
  database.function("gen_random_uuid", () => randomUUID());
  database.function("now", () => new Date().toISOString());
  return database;
}
