import path from "node:path";
import { appBasePath } from "@/lib/app-path";

const configuredStorageReserveRatio = Number(process.env.STORAGE_RESERVE_RATIO ?? "0.2");
const dataDir = process.env.DATA_DIR ?? ".data";

export const env = {
  dataDir,
  databaseFile: process.env.DATABASE_FILE ?? path.join(dataDir, "prototype-hub.sqlite3"),
  manageUrl: `http://localhost:3000${appBasePath}`,
  demoUrl: `http://localhost:3000${appBasePath}`,
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
};

const databaseConfigured = Boolean(process.env.DATABASE_FILE);

export const isDemoMode =
  process.env.NODE_ENV !== "production" &&
  (process.env.DEMO_MODE === "true" || !databaseConfigured);

export function assertDatabaseConfigured() {
  if (!databaseConfigured) {
    throw new Error("缺少 DATABASE_FILE，无法打开 SQLite 数据库");
  }
}
