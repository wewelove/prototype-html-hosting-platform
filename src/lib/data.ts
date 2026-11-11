import { numberedPlaceholders, query } from "@/lib/db";
import { withBasePath } from "@/lib/app-path";
import { decryptSharePassword } from "@/lib/share-password-crypto";
import type {
  BusinessCategory,
  Department,
  InvitationCode,
  LoginLog,
  PlatformStats,
  PrototypeGroup,
  PrototypeProject,
  UserProfile,
} from "@/lib/types";
import { DEFAULT_USER_STORAGE_QUOTA_BYTES } from "@/lib/storage-quota";

function isoDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("数据库时间格式无效");
  return date.toISOString();
}

export async function listDepartments(): Promise<Department[]> {
  const result = await query(
    "select id, name, parent_id, sort_order from departments order by sort_order, name",
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    parentId: row.parent_id ? String(row.parent_id) : null,
    sortOrder: Number(row.sort_order),
  }));
}

export async function listCategories(): Promise<BusinessCategory[]> {
  const result = await query(
    "select id, name, sort_order, enabled from business_categories order by sort_order, name",
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sortOrder: Number(row.sort_order),
    enabled: Boolean(row.enabled),
  }));
}

function mapGroup(row: Record<string, unknown>): PrototypeGroup {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name),
    sortOrder: Number(row.sort_order),
  };
}

export async function listGroups(ownerId: string): Promise<PrototypeGroup[]> {
  const result = await query(
    `select id, owner_id, parent_id, name, sort_order
       from prototype_groups where owner_id = $1 order by sort_order, name`,
    [ownerId],
  );
  return result.rows.map(mapGroup);
}

export async function listGroupsForOwners(ownerIds: string[]): Promise<PrototypeGroup[]> {
  if (ownerIds.length === 0) return [];
  const result = await query(
    `select id, owner_id, parent_id, name, sort_order
       from prototype_groups
      where owner_id in (${numberedPlaceholders(ownerIds.length)})
      order by sort_order, name`,
    ownerIds,
  );
  return result.rows.map(mapGroup);
}

function mapProject(row: Record<string, unknown>, includeSharePassword = false): PrototypeProject {
  const id = String(row.id);
  const updatedAt = isoDate(row.updated_at);
  return {
    id,
    publicCode: String(row.public_code),
    shareCode: String(row.share_code),
    name: String(row.name),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name ?? "未知人员"),
    departmentId: String(row.department_id),
    departmentName: String(row.department_name ?? "未知部门"),
    groupId: row.group_id ? String(row.group_id) : null,
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: row.category_name ? String(row.category_name) : null,
    htmlPath: String(row.html_path),
    sourceKind: (row.source_kind ?? "folder") as PrototypeProject["sourceKind"],
    sourceName: String(row.source_name ?? `${row.name}.zip`),
    previewPath: row.preview_path ? String(row.preview_path) : null,
    previewUrl: row.preview_path
      ? withBasePath(`/api/project-previews/${id}?v=${encodeURIComponent(updatedAt)}`)
      : null,
    previewStatus: (row.preview_status ?? (row.preview_path ? "ready" : "pending")) as PrototypeProject["previewStatus"],
    previewError: row.preview_error ? String(row.preview_error) : null,
    previewSize: Number(row.preview_size ?? 0),
    fileSize: Number(row.file_size),
    isPublic: Boolean(row.is_public),
    shareEnabled: Boolean(row.share_enabled),
    shareExpiresAt: row.share_expires_at ? isoDate(row.share_expires_at) : null,
    shareHasPassword: Boolean(row.share_password_hash),
    sharePassword: includeSharePassword
      ? decryptSharePassword(row.share_password_encrypted ? String(row.share_password_encrypted) : null)
      : undefined,
    shareVersion: Number(row.share_version ?? 1),
    visitCount: Number(row.visit_count),
    createdAt: isoDate(row.created_at),
    updatedAt,
  };
}

const projectSelect = `
  select p.*, u.name as owner_name, d.name as department_name, c.name as category_name
    from projects p
    join users u on u.id = p.owner_id
    join departments d on d.id = p.department_id
    left join business_categories c on c.id = p.category_id`;

export async function listProjectsForOwner(ownerId: string): Promise<PrototypeProject[]> {
  const result = await query(`${projectSelect} where p.owner_id = $1 order by p.updated_at desc`, [ownerId]);
  return result.rows.map((row) => mapProject(row, true));
}

export async function listPublicProjects(): Promise<PrototypeProject[]> {
  const result = await query(`${projectSelect} where p.is_public = true order by p.updated_at desc`);
  return result.rows.map((row) => mapProject(row));
}

export async function listProjectsForDepartments(
  departmentIds: ReadonlySet<string>,
): Promise<PrototypeProject[]> {
  if (departmentIds.size === 0) return [];
  // SQLite 不支持数组参数，使用编号占位符展开部门列表。
  const departmentIdList = [...departmentIds];
  const result = await query(
    `${projectSelect}
      where p.department_id in (${numberedPlaceholders(departmentIdList.length)})
      order by p.updated_at desc`,
    departmentIdList,
  );
  return result.rows.map((row) => mapProject(row, true));
}

export async function getProjectById(projectId: string): Promise<PrototypeProject | null> {
  const result = await query(`${projectSelect} where p.id = $1`, [projectId]);
  return result.rows[0] ? mapProject(result.rows[0], true) : null;
}

export async function getProjectByCode(
  code: string,
  route: "public" | "share",
): Promise<PrototypeProject | null> {
  const column = route === "public" ? "public_code" : "share_code";
  const result = await query(`${projectSelect} where p.${column} = $1`, [code]);
  return result.rows[0] ? mapProject(result.rows[0]) : null;
}

function mapUser(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    account: String(row.account),
    name: String(row.name),
    departmentId: String(row.department_id),
    departmentName: String(row.department_name ?? "未分配部门"),
    role: row.role as UserProfile["role"],
    status: row.status as UserProfile["status"],
    mustChangePassword: Boolean(row.must_change_password),
    tempPasswordExpiresAt: row.temp_password_expires_at
      ? isoDate(row.temp_password_expires_at)
      : null,
    storageQuotaBytes: Number(row.storage_quota_bytes ?? DEFAULT_USER_STORAGE_QUOTA_BYTES),
    storageUsedBytes: row.storage_used_bytes === undefined
      ? undefined
      : Number(row.storage_used_bytes),
    createdAt: isoDate(row.created_at),
  };
}

export async function listUsers(): Promise<UserProfile[]> {
  const result = await query(
    `select u.id, u.account, u.name, u.department_id, d.name as department_name,
            u.role, u.status, u.must_change_password, u.temp_password_expires_at,
            u.storage_quota_bytes,
            coalesce(sum(p.file_size + p.preview_size), 0) as storage_used_bytes,
            u.created_at
       from users u
       join departments d on d.id = u.department_id
       left join projects p on p.owner_id = u.id
      group by u.id, d.name
      order by u.created_at desc`,
  );
  return result.rows.map(mapUser);
}

export async function listInvitations(): Promise<InvitationCode[]> {
  const result = await query(
    `select i.id, i.code, i.expires_at, i.used_at, i.created_at,
            coalesce(creator.name, i.created_by_name) as created_by_name,
            coalesce(used_user.name, i.used_by_name) as used_by_name
       from invitation_codes i
       left join users creator on creator.id = i.created_by
       left join users used_user on used_user.id = i.used_by
      order by i.created_at desc`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    expiresAt: isoDate(row.expires_at),
    usedAt: row.used_at ? isoDate(row.used_at) : null,
    usedByName: row.used_by_name ? String(row.used_by_name) : null,
    createdByName: String(row.created_by_name ?? "未知人员"),
    createdAt: isoDate(row.created_at),
  }));
}

function toStats(row?: Record<string, unknown> | null): PlatformStats {
  return {
    pv: Number(row?.pv ?? 0),
    uv: Number(row?.uv ?? 0),
    uploads: Number(row?.uploads ?? 0),
    updates: Number(row?.updates ?? 0),
    logins: Number(row?.logins ?? 0),
    projects: Number(row?.projects ?? 0),
    storageBytes: Number(row?.storage_bytes ?? 0),
  };
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const result = await query(`
    select
      (select count(*) from project_visits) as pv,
      (select count(distinct coalesce(user_id, visitor_key)) from project_visits) as uv,
      (select count(*) from platform_events where event_type = 'upload') as uploads,
      (select count(*) from platform_events where event_type = 'update') as updates,
      (select count(*) from login_logs where success = true) as logins,
      (select count(*) from projects) as projects,
      (select coalesce(sum(file_size + preview_size), 0) from projects) as storage_bytes
  `);
  return toStats(result.rows[0]);
}

export async function getScopedPlatformStats(
  departmentIds: ReadonlySet<string>,
): Promise<PlatformStats> {
  if (departmentIds.size === 0) return toStats(null);
  const departmentIdList = [...departmentIds];
  const placeholders = numberedPlaceholders(departmentIdList.length);
  const result = await query(
    `with scoped_projects as (
       select id, file_size, preview_size from projects where department_id in (${placeholders})
     ), scoped_users as (
       select id from users where department_id in (${placeholders})
     )
     select
       (select count(*) from project_visits where project_id in (select id from scoped_projects)) as pv,
       (select count(distinct coalesce(user_id, visitor_key)) from project_visits where project_id in (select id from scoped_projects)) as uv,
       (select count(*) from platform_events where event_type = 'upload' and user_id in (select id from scoped_users)) as uploads,
       (select count(*) from platform_events where event_type = 'update' and user_id in (select id from scoped_users)) as updates,
       (select count(*) from login_logs where success = true and user_id in (select id from scoped_users)) as logins,
       (select count(*) from scoped_projects) as projects,
       (select coalesce(sum(file_size + preview_size), 0) from scoped_projects) as storage_bytes`,
    [...departmentIdList, ...departmentIdList],
  );
  return toStats(result.rows[0]);
}

function mapLoginLog(row: Record<string, unknown>): LoginLog {
  return {
    id: String(row.id),
    account: String(row.account),
    userName: row.user_name ? String(row.user_name) : null,
    success: Boolean(row.success),
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    createdAt: isoDate(row.created_at),
  };
}

export async function listLoginLogs(): Promise<LoginLog[]> {
  const result = await query(
    `select l.id, l.account, l.success, l.ip_address, l.created_at, u.name as user_name
       from login_logs l left join users u on u.id = l.user_id
      order by l.created_at desc`,
  );
  return result.rows.map(mapLoginLog);
}

export async function listScopedLoginLogs(userIds: string[]): Promise<LoginLog[]> {
  if (userIds.length === 0) return [];
  const result = await query(
    `select l.id, l.account, l.success, l.ip_address, l.created_at, u.name as user_name
       from login_logs l left join users u on u.id = l.user_id
      where l.user_id in (${numberedPlaceholders(userIds.length)}) order by l.created_at desc`,
    userIds,
  );
  return result.rows.map(mapLoginLog);
}
