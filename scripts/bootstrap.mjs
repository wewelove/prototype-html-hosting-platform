import nextEnv from "@next/env";
import { hashSync } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { openDatabase, resolveDatabaseFile } from "./sqlite.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const database = openDatabase(resolveDatabaseFile());

try {
  database.exec("begin immediate");
  const existing = database.prepare("select 1 from users limit 1").get();
  if (existing) {
    database.exec("rollback");
    console.log("系统已有用户，已跳过超级管理员初始化。");
  } else {
    const account = process.env.BOOTSTRAP_SUPER_ADMIN_ACCOUNT?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
    if (!account || !password || password.length < 8) {
      throw new Error("首次启动时必须设置超级管理员账号及至少 8 位初始密码");
    }
    const departmentName = process.env.BOOTSTRAP_DEPARTMENT_NAME || "产品中心";
    const departmentId = randomUUID();
    database
      .prepare("insert into departments (id, name, sort_order) values (?, ?, 1)")
      .run(departmentId, departmentName);
    database
      .prepare(
        `insert into users (id, account, password_hash, name, department_id, role)
         values (?, ?, ?, ?, ?, 'super_admin')`,
      )
      .run(
        randomUUID(),
        account,
        hashSync(password, 10),
        process.env.BOOTSTRAP_SUPER_ADMIN_NAME || "系统管理员",
        departmentId,
      );
    const insertCategory = database.prepare(
      `insert into business_categories (id, name, sort_order) values (?, ?, ?)
       on conflict (name) do nothing`,
    );
    for (const [name, sortOrder] of [["企业服务", 10], ["协作工具", 20], ["数据产品", 30]]) {
      insertCategory.run(randomUUID(), name, sortOrder);
    }
    database.exec("commit");
    console.log(`超级管理员 ${account} 初始化完成。`);
  }
} catch (error) {
  try {
    database.exec("rollback");
  } catch {
    // 事务可能已经结束。
  }
  throw error;
} finally {
  database.close();
}
