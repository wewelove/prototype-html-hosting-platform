import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const workspace = mkdtempSync(path.join(tmpdir(), "prototype-hub-sqlite-"));
const databaseFile = path.join(workspace, "prototype-hub.sqlite3");

// 必须在导入 @/lib/env 之前指定数据库位置。
process.env.DATABASE_FILE = databaseFile;
process.env.DATA_DIR = workspace;

let db: typeof import("@/lib/db");

beforeAll(async () => {
  // 先通过真实迁移脚本建库，再让应用层连接同一个 SQLite 文件。
  execFileSync(process.execPath, [path.join("scripts", "migrate.mjs")], {
    env: { ...process.env, DATA_DIR: workspace, DATABASE_FILE: databaseFile },
    stdio: "pipe",
  });
  vi.resetModules();
  db = await import("@/lib/db");
});

afterAll(() => {
  // 先关闭连接，Windows 上打开的文件无法删除。
  db.closeDatabase();
  rmSync(workspace, { recursive: true, force: true });
});

async function seedBaseData() {
  const department = await db.query<{ id: string }>(
    "insert into departments (name, sort_order) values ($1, 1) returning id",
    ["产品中心"],
  );
  const departmentId = department.rows[0].id;
  const user = await db.query<{ id: string }>(
    `insert into users (account, password_hash, name, department_id, role)
     values ($1, $2, $3, $4, 'super_admin') returning id`,
    ["admin", "hash", "系统管理员", departmentId],
  );
  return { departmentId, userId: user.rows[0].id };
}

describe("SQLite 数据访问层", () => {
  it("迁移脚本创建出可用的 SQLite 数据库文件", () => {
    expect(db.getDatabaseFilePath()).toBe(databaseFile);
    expect(db.getDatabaseFilePath().endsWith("prototype-hub.sqlite3")).toBe(true);
  });

  it("支持编号占位符、默认主键、布尔值与 RETURNING", async () => {
    const { departmentId, userId } = await seedBaseData();
    const created = await db.query<{ id: string; is_public: number; created_at: string }>(
      `insert into projects
         (public_code, share_code, name, owner_id, department_id, html_path, file_size,
          source_kind, source_name, is_public)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, is_public, created_at`,
      ["code1", "share1", "原型一", userId, departmentId, "admin/1/index.html", 2048, "zip", "a.zip", true],
    );
    expect(created.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.rows[0].is_public).toBe(1);
    expect(Number.isNaN(new Date(created.rows[0].created_at).getTime())).toBe(false);
  });

  it("访问记录触发器自动累加访问量", async () => {
    const project = await db.query<{ id: string; visit_count: number }>(
      "select id, visit_count from projects where public_code = $1",
      ["code1"],
    );
    await db.query(
      "insert into project_visits (project_id, visitor_key, access_type) values ($1, $2, $3)",
      [project.rows[0].id, "visitor-1", "share"],
    );
    const updated = await db.query<{ visit_count: number }>(
      "select visit_count from projects where public_code = $1",
      ["code1"],
    );
    expect(updated.rows[0].visit_count).toBe(project.rows[0].visit_count + 1);
  });

  it("用编号占位符展开 in 列表并支持 collate nocase 账号查询", async () => {
    const placeholders = db.numberedPlaceholders(2);
    const departments = await db.query<{ name: string }>(
      `select name from departments where name in (${placeholders})`,
      ["产品中心", "其他部门"],
    );
    expect(departments.rows.map((row) => row.name)).toEqual(["产品中心"]);

    const account = await db.query<{ account: string }>(
      "select account from users where account = $1",
      ["ADMIN"],
    );
    expect(account.rows[0].account).toBe("admin");
  });

  it("识别唯一约束冲突并保持事务原子性", async () => {
    const categoryName = "企业服务";
    await db.query("insert into business_categories (id, name, sort_order) values ($1, $2, $3)", [
      crypto.randomUUID(),
      categoryName,
      10,
    ]);
    await expect(
      db.query("insert into business_categories (id, name, sort_order) values ($1, $2, $3)", [
        crypto.randomUUID(),
        categoryName,
        20,
      ]),
    ).rejects.toSatisfy((error: unknown) => db.isUniqueConstraintError(error));

    await db.query(
      "insert into business_categories (id, name, sort_order) values ($1, $2, $3) on conflict (name) do nothing",
      [crypto.randomUUID(), categoryName, 20],
    );

    const before = await db.query<{ total: number }>(
      "select count(*) as total from business_categories",
    );
    await expect(
      db.withTransaction(async (client) => {
        await client.query(
          "insert into business_categories (id, name, sort_order) values ($1, $2, $3)",
          [crypto.randomUUID(), "临时分类", 99],
        );
        throw new Error("ROLLBACK");
      }),
    ).rejects.toThrow("ROLLBACK");
    const after = await db.query<{ total: number }>(
      "select count(*) as total from business_categories",
    );
    expect(after.rows[0].total).toBe(before.rows[0].total);

    const committed = await db.withTransaction(async (client) => {
      await client.query(
        "insert into business_categories (id, name, sort_order) values ($1, $2, $3)",
        [crypto.randomUUID(), "协作工具", 20],
      );
      return client.query<{ total: number }>("select count(*) as total from business_categories");
    });
    expect(committed.rows[0].total).toBe(before.rows[0].total + 1);
  });

  it("聚合统计与磁盘用量求和返回数字", async () => {
    const stats = await db.query<{ projects: number; storage_bytes: number }>(
      `select (select count(*) from projects) as projects,
              (select coalesce(sum(file_size + preview_size), 0) from projects) as storage_bytes`,
    );
    expect(stats.rows[0].projects).toBe(1);
    expect(stats.rows[0].storage_bytes).toBe(2048);
  });
});