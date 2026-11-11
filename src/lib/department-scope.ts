import { query } from "@/lib/db";
import { listDepartments } from "@/lib/data";
import type { Department, UserProfile } from "@/lib/types";

function descendants(departments: Department[], roots: string[]) {
  const result = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const department of departments) {
      if (department.parentId && result.has(department.parentId) && !result.has(department.id)) {
        result.add(department.id);
        changed = true;
      }
    }
  }
  return result;
}

/** 普通用户只能看本部门；管理员看其管辖部门及下级；超级管理员看全部。 */
export async function getAllowedDepartmentIds(user: UserProfile) {
  const departments = await listDepartments();
  if (user.role === "user") return new Set([user.departmentId]);
  if (user.role === "super_admin") return new Set(departments.map((item) => item.id));

  const scopeRows = await query<{ department_id: string }>(
    "select department_id from admin_department_scopes where admin_id = $1",
    [user.id],
  );
  const roots = scopeRows.rows.map((item) => String(item.department_id));
  if (roots.length === 0) roots.push(user.departmentId);
  return descendants(departments, roots);
}
