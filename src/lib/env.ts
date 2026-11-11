import path from "node:path";
import { appBasePath } from "@/lib/app-path";

const configuredStorageReserveRatio = Number(process.env.STORAGE_RESERVE_RATIO ?? "0.2");
const dataDir = process.env.DATA_DIR ?? ".data";

/**
 * 内网部署下的站点地址：通过启动参数注入实际访问地址
 * （例如 http://192.168.1.100:3000），留空则回退到本机端口。
 */
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `http://localhost:${process.env.APP_HOST_PORT ?? "3000"}`;

export const env = {
  dataDir,
  // 默认值与 scripts/sqlite.mjs 保持一致，避免开发环境与容器读到不同库文件。
  databaseFile: process.env.DATABASE_FILE ?? path.join(dataDir, "axhub.sqlite3"),
  // 对外访问根地址（含 basePath），用于生成分享与查看链接。
  siteUrl: `${baseUrl}${appBasePath}`,
  authCookieDomain: undefined,
  chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  sessionSigningSecret: process.env.SESSION_SIGNING_SECRET,
  sharePasswordEncryptionKey: process.env.SHARE_PASSWORD_ENCRYPTION_KEY,
  storageReserveRatio:
    Number.isFinite(configuredStorageReserveRatio) &&
    configuredStorageReserveRatio >= 0 &&
    configuredStorageReserveRatio < 1
      ? configuredStorageReserveRatio
      : 0.2,
  // 内网通常通过 HTTP 访问，Secure Cookie 需按实际协议显式开启。
  cookieSecure: process.env.COOKIE_SECURE === "true",
};

const databaseConfigured = Boolean(process.env.DATABASE_FILE);

export function assertDatabaseConfigured() {
  if (!databaseConfigured) {
    throw new Error("缺少 DATABASE_FILE，无法打开 SQLite 数据库");
  }
}
