import { query } from "@/lib/db";
import { readPrototypeAsset, readStoredFile } from "@/lib/file-storage";
import type { PrototypeProject } from "@/lib/types";

export async function getProjectHtml(project: PrototypeProject) {
  return (await readStoredFile(project.htmlPath)).toString("utf8");
}

export async function getProjectAsset(project: PrototypeProject, assetPath: string) {
  return readPrototypeAsset(project.htmlPath, assetPath);
}

export async function recordProjectVisit(
  project: PrototypeProject,
  userId: string | null,
  visitorKey: string | null,
  accessType: "public" | "share" | "owner" | "admin",
) {
  await query(
    "insert into project_visits (project_id, user_id, visitor_key, access_type) values ($1, $2, $3, $4)",
    [project.id, userId, visitorKey, accessType],
  );
}
