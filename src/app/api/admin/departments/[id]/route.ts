import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { listDepartments } from "@/lib/data";
import { isUniqueConstraintError, query, type DbValue } from "@/lib/db";
import { readRequestJson } from "@/lib/request-json";

const schema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  parentId: z.string().min(1).nullable().optional(),
});

async function allow() {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ message: "仅超级管理员可维护部门" }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await allow();
  if (denied) return denied;
  const parsed = schema.safeParse(await readRequestJson(request));
  if (!parsed.success) return NextResponse.json({ message: "部门信息无效" }, { status: 400 });
  const { id } = await context.params;
  if (parsed.data.parentId === id) {
    return NextResponse.json({ message: "上级部门不能选择自身" }, { status: 400 });
  }

  const departments = await listDepartments();
  const current = departments.find((item) => item.id === id);
  if (!current) return NextResponse.json({ message: "部门不存在" }, { status: 404 });
  if (parsed.data.parentId !== undefined) {
    let cursor = parsed.data.parentId;
    while (cursor) {
      if (cursor === id) {
        return NextResponse.json({ message: "不能将部门移动到自己的下级" }, { status: 400 });
      }
      cursor = departments.find((item) => item.id === cursor)?.parentId ?? null;
    }
    if (parsed.data.parentId && !departments.some((item) => item.id === parsed.data.parentId)) {
      return NextResponse.json({ message: "上级部门不存在" }, { status: 400 });
    }
  }

  try {
    const values: DbValue[] = [];
    const assignments = ["updated_at = now()"];
    if (parsed.data.name) {
      values.push(parsed.data.name);
      assignments.push(`name = $${values.length}`);
    }
    if (parsed.data.parentId !== undefined) {
      values.push(parsed.data.parentId);
      assignments.push(`parent_id = $${values.length}`);
    }
    values.push(id);
    await query(`update departments set ${assignments.join(", ")} where id = $${values.length}`, values);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const duplicate = isUniqueConstraintError(error);
    return NextResponse.json({ message: duplicate ? "同级部门名称已存在" : "部门保存失败" }, { status: duplicate ? 409 : 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await allow();
  if (denied) return denied;
  const { id } = await context.params;
  const hasReferences = Boolean((await query(
    `select exists(select 1 from departments where parent_id = $1)
           or exists(select 1 from users where department_id = $1)
           or exists(select 1 from projects where department_id = $1) as used`,
      [id],
    )).rows[0]?.used);
  if (hasReferences) {
    return NextResponse.json({ message: "部门下存在子部门、人员或原型，不能删除" }, { status: 409 });
  }
  await query("delete from departments where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
