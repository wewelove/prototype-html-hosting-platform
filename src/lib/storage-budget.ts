import { statfs } from "node:fs/promises";
import { query, type DbClient, type DbValue } from "@/lib/db";
import { demoStore } from "@/lib/demo-store";
import { env, isDemoMode } from "@/lib/env";
import { DEFAULT_USER_STORAGE_QUOTA_BYTES } from "@/lib/storage-quota";

const DEFAULT_STORAGE_RESERVE_RATIO = 0.2;

export interface PlatformStorageBudget {
  prototypeUsedBytes: number;
  diskTotalBytes: number;
  diskUsedBytes: number;
  diskAvailableBytes: number;
  systemAndOtherUsedBytes: number;
  reserveRatio: number;
  reserveBytes: number;
  safeCapacityBytes: number;
  uploadAvailableBytes: number;
}

export function calculatePlatformStorageBudget(
  prototypeUsedBytes: number,
  diskTotalBytes: number,
  diskAvailableBytes: number,
  reserveRatio = DEFAULT_STORAGE_RESERVE_RATIO,
): PlatformStorageBudget {
  const reserveBytes = Math.floor(diskTotalBytes * reserveRatio);
  const uploadAvailableBytes = Math.max(0, diskAvailableBytes - reserveBytes);
  const diskUsedBytes = Math.max(0, diskTotalBytes - diskAvailableBytes);
  // SQLite 数据库文件、系统与其它占用统一归入剩余部分，不再单独统计备份仓库。
  const systemAndOtherUsedBytes = Math.max(0, diskUsedBytes - prototypeUsedBytes);
  return {
    prototypeUsedBytes,
    diskTotalBytes,
    diskUsedBytes,
    diskAvailableBytes,
    systemAndOtherUsedBytes,
    reserveRatio,
    reserveBytes,
    safeCapacityBytes: prototypeUsedBytes + uploadAvailableBytes,
    uploadAvailableBytes,
  };
}

async function queryTotal(client: DbClient | undefined, sql: string, values: DbValue[] = []) {
  const result = client
    ? await client.query<{ total: number }>(sql, values)
    : await query<{ total: number }>(sql, values);
  return Number(result.rows[0]?.total ?? 0);
}

export async function getStorageUsageBytes(ownerId?: string, client?: DbClient) {
  if (isDemoMode) {
    return demoStore.projects
      .filter((project) => !ownerId || project.ownerId === ownerId)
      .reduce((total, project) => total + project.fileSize + project.previewSize, 0);
  }
  // SQLite 不支持数组参数，按是否限定负责人使用两条固定 SQL。
  return ownerId
    ? queryTotal(
      client,
      `select coalesce(sum(file_size + preview_size), 0) as total
           from projects where owner_id = $1`,
      [ownerId],
    )
    : queryTotal(
      client,
      "select coalesce(sum(file_size + preview_size), 0) as total from projects",
    );
}

async function getDiskSpace() {
  let stats;
  try {
    stats = await statfs(env.dataDir, { bigint: true });
  } catch {
    stats = await statfs(process.cwd(), { bigint: true });
  }
  return {
    totalBytes: Number(stats.blocks * stats.bsize),
    availableBytes: Number(stats.bavail * stats.bsize),
  };
}

export async function getPlatformStorageBudget(
  client?: DbClient,
): Promise<PlatformStorageBudget> {
  const [prototypeUsedBytes, disk] = await Promise.all([
    getStorageUsageBytes(undefined, client),
    getDiskSpace(),
  ]);
  return calculatePlatformStorageBudget(
    prototypeUsedBytes,
    disk.totalBytes,
    disk.availableBytes,
    env.storageReserveRatio,
  );
}

async function getUserQuotaBytes(ownerId: string, client?: DbClient) {
  if (isDemoMode) {
    return demoStore.users.find((user) => user.id === ownerId)?.storageQuotaBytes
      ?? DEFAULT_USER_STORAGE_QUOTA_BYTES;
  }
  const sql = "select storage_quota_bytes from users where id = $1";
  const result = client
    ? await client.query<{ storage_quota_bytes: number }>(sql, [ownerId])
    : await query<{ storage_quota_bytes: number }>(sql, [ownerId]);
  if (!result.rows[0]) throw new Error("原型负责人不存在");
  return Number(result.rows[0].storage_quota_bytes);
}

export async function assertUploadWithinBudget(
  ownerId: string,
  fileSize: number,
  replacedSize = 0,
  client?: DbClient,
) {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error("原型文件不能为空");
  }
  // 传入 client 时调用方已处于 BEGIN IMMEDIATE 事务中，用量校验与原型写入在同一把写锁内完成。
  const [platformBudget, userUsedBytes, userQuotaBytes] = client
    ? [
      await getPlatformStorageBudget(client),
      await getStorageUsageBytes(ownerId, client),
      await getUserQuotaBytes(ownerId, client),
    ]
    : await Promise.all([
      getPlatformStorageBudget(),
      getStorageUsageBytes(ownerId),
      getUserQuotaBytes(ownerId),
    ]);
  if (userUsedBytes - replacedSize + fileSize > userQuotaBytes) {
    throw new Error("个人存储用量已达到阈值，请删除不再使用的原型后重试");
  }
  if (fileSize > platformBudget.uploadAvailableBytes) {
    throw new Error("平台存储已达到安全阈值，请删除不再使用的原型后重试");
  }
  return {
    userUsedBytes,
    userQuotaBytes,
    platformUsedBytes: platformBudget.prototypeUsedBytes,
    platformLimitBytes: platformBudget.safeCapacityBytes,
  };
}

export function isHtmlDocument(content: string) {
  const head = content.replace(/^\uFEFF/, "").trimStart().slice(0, 64 * 1024);
  if (!head || head.includes("\u0000")) return false;
  if (/<!doctype\s+html\b|<html\b/i.test(head)) return true;
  // 浏览器可以直接渲染未包含 html/body 外壳的 HTML 片段，很多原型生成器会输出这种文件。
  return /<(?:head|body|title|meta|link|style|script|main|div|section|article|header|footer|nav|aside|form|table|canvas|svg|h[1-6]|p)\b[^>]*>/i.test(head);
}
