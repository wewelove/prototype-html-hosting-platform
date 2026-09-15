import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { assertDatabaseConfigured, env } from "@/lib/env";

/** 允许传入 SQL 的参数类型；布尔值与 Date 会在绑定前转换成 SQLite 支持的值。 */
export type DbValue = SQLInputValue | boolean | Date | undefined;

export type DbRow = Record<string, unknown>;

export interface DbQueryResult<Row extends DbRow = DbRow> {
  rows: Row[];
  rowCount: number;
}

export interface DbClient {
  query<Row extends DbRow = DbRow>(
    sql: string,
    values?: DbValue[],
  ): Promise<DbQueryResult<Row>>;
}

declare global {
  // 开发环境热更新时复用同一个 SQLite 连接，避免重复打开数据库文件。
  var __prototypeDatabase: DatabaseSync | undefined;
}

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

const returnsRowsPattern = /^\s*(?:select|with|pragma)\b/i;
const returningPattern = /\breturning\b/i;
// PostgreSQL 使用 $1 编号占位符，SQLite 的 ?NNN 语义一致，改写后可直接复用既有 SQL。
const numberedPlaceholderPattern = /\$(\d+)/g;

const transactionContext = new AsyncLocalStorage<true>();

/**
 * SQLite 只有一条写入通道，因此在同一进程内把顶层查询与事务串行化：
 * 事务执行期间其它请求的查询会排在后面，避免写入被并入他人的事务。
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function openDatabase() {
  if (!globalThis.__prototypeDatabase) {
    mkdirSync(path.dirname(env.databaseFile), { recursive: true });
    const database = new DatabaseSync(env.databaseFile, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    // WAL 允许读写并行，NORMAL 在 WAL 下仍能保证崩溃一致性。
    database.exec("pragma journal_mode = WAL");
    database.exec("pragma synchronous = NORMAL");
    // 沿用 PostgreSQL 时代的函数名，迁移与业务 SQL 中的默认值表达式无需改写。
    database.function("gen_random_uuid", () => randomUUID());
    database.function("now", () => new Date().toISOString());
    globalThis.__prototypeDatabase = database;
  }
  return globalThis.__prototypeDatabase;
}

function toSqliteValue(value: DbValue): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function execute<Row extends DbRow>(sql: string, values: DbValue[]): DbQueryResult<Row> {
  const statement = openDatabase().prepare(sql.replace(numberedPlaceholderPattern, "?$1"));
  const bound = values.map(toSqliteValue);
  if (returnsRowsPattern.test(sql) || returningPattern.test(sql)) {
    const rows = statement.all(...bound) as Row[];
    return { rows, rowCount: rows.length };
  }
  const result = statement.run(...bound);
  return { rows: [], rowCount: Number(result.changes) };
}

/** SQLite 不支持数组参数，`in (...)` 列表需要用编号占位符展开。 */
export function numberedPlaceholders(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => `$${offset + index + 1}`).join(", ");
}

/** 唯一约束冲突，对应 PostgreSQL 的 23505 错误码。 */
export function isUniqueConstraintError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { errcode?: unknown; message?: unknown };
  if (
    candidate.errcode === SQLITE_CONSTRAINT_UNIQUE
    || candidate.errcode === SQLITE_CONSTRAINT_PRIMARYKEY
  ) {
    return true;
  }
  return typeof candidate.message === "string" && /unique constraint failed/i.test(candidate.message);
}

function createClient(): DbClient {
  return {
    query: async (sql, values = []) => execute(sql, values),
  };
}

export function query<Row extends DbRow = DbRow>(sql: string, values: DbValue[] = []) {
  // 已在事务上下文中：直接复用当前连接，避免与自身事务互相等待。
  if (transactionContext.getStore()) return Promise.resolve(execute<Row>(sql, values));
  return enqueue(async () => execute<Row>(sql, values));
}

export function withTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = createClient();
  // 嵌套调用直接复用当前事务，避免自等待死锁。
  if (transactionContext.getStore()) return work(client);
  return enqueue(async () => {
    const database = openDatabase();
    // BEGIN IMMEDIATE 立即持有写锁，等价于 PostgreSQL 事务里的 FOR UPDATE 保护。
    database.exec("begin immediate");
    try {
      const result = await transactionContext.run(true, () => work(client));
      database.exec("commit");
      return result;
    } catch (error) {
      try {
        database.exec("rollback");
      } catch {
        // 事务可能已被 SQLite 自动回滚。
      }
      throw error;
    }
  });
}

export function getDatabaseFilePath() {
  assertDatabaseConfigured();
  return env.databaseFile;
}

/** 关闭当前进程的 SQLite 连接，供测试与优雅退出使用。 */
export function closeDatabase() {
  if (!globalThis.__prototypeDatabase) return;
  globalThis.__prototypeDatabase.close();
  globalThis.__prototypeDatabase = undefined;
}
