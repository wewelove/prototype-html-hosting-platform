import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getProjectById } from "@/lib/data";
import { query, type DbValue } from "@/lib/db";
import { removeStoredFile, removeStoredPrototype } from "@/lib/file-storage";
import { canManageProject } from "@/lib/project-permission";
import { readRequestJson } from "@/lib/request-json";
import { encryptSharePassword } from "@/lib/share-password-crypto";

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  groupId: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  shareEnabled: z.boolean().optional(),
  shareExpiresAt: z.string().datetime().nullable().optional(),
  sharePassword: z.string().max(64).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const project = await getProjectById(id);
  if (!project || !(await canManageProject(user, project))) {
    return NextResponse.json({ message: "原型不存在或无权操作" }, { status: 404 });
  }
  const parsed = schema.safeParse(await readRequestJson(request));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const input = parsed.data;

  if (input.groupId) {
    const validGroup = Boolean(
      (await query("select 1 from prototype_groups where id = $1 and owner_id = $2", [input.groupId, project.ownerId])).rows[0],
    );
    if (!validGroup) {
      return NextResponse.json({ message: "所选分组不属于原型负责人" }, { status: 400 });
    }
  }

  if (input.isPublic === true) {
    const categoryId = input.categoryId ?? project.categoryId;
    const category = await query(
      "select 1 from business_categories where id = $1 and enabled = true",
      [categoryId],
    );
    if (!category.rows[0]) {
      return NextResponse.json({ message: "公开原型前必须选择业务分类" }, { status: 400 });
    }
  }

  if (input.shareExpiresAt && new Date(input.shareExpiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ message: "分享截止时间必须晚于当前时间" }, { status: 400 });
  }

  const values: DbValue[] = [];
  const assignments = ["updated_at = now()"];
  const add = (column: string, value: DbValue) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };
  if (input.name !== undefined) add("name", input.name);
  if (input.groupId !== undefined) add("group_id", input.groupId);
  if (input.categoryId !== undefined) add("category_id", input.categoryId);
  if (input.isPublic !== undefined) add("is_public", input.isPublic);
  if (input.shareEnabled !== undefined) add("share_enabled", input.shareEnabled);
  if (input.shareExpiresAt !== undefined) add("share_expires_at", input.shareExpiresAt);
  if (input.sharePassword !== undefined) {
    add("share_password_hash", input.sharePassword ? await hash(input.sharePassword, 10) : null);
    add("share_password_encrypted", input.sharePassword ? encryptSharePassword(input.sharePassword) : null);
  }
  if (
    input.shareEnabled !== undefined
    || input.shareExpiresAt !== undefined
    || input.sharePassword !== undefined
  ) {
    assignments.push("share_version = share_version + 1");
  }
  values.push(project.id);
  await query(`update projects set ${assignments.join(", ")} where id = $${values.length}`, values);
  return NextResponse.json({ project: await getProjectById(project.id) });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const project = await getProjectById(id);
  if (!project || !(await canManageProject(user, project))) {
    return NextResponse.json({ message: "原型不存在或无权操作" }, { status: 404 });
  }

  const deleted = await query<{ html_path: string; preview_path: string | null }>(
    "delete from projects where id = $1 returning html_path, preview_path",
    [project.id],
  );
  const stored = deleted.rows[0];
  await Promise.all([
    removeStoredPrototype(stored?.html_path ?? project.htmlPath),
    removeStoredFile(stored?.preview_path ?? project.previewPath),
  ]).catch((error) => console.error("原型文件清理失败", error));
  return NextResponse.json({ ok: true });
}
