import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProjectById } from "@/lib/data";
import { readStoredFile, readStoredPrototypeBundle } from "@/lib/file-storage";
import {
  attachmentDisposition,
  createPrototypeZip,
  projectDownloadName,
} from "@/lib/project-download";
import { canDownloadProject } from "@/lib/project-permission";

export const maxDuration = 60;

/** 下载原型：单 HTML 原样返回，项目包/压缩包重新打包为 ZIP。 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "请先登录" }, { status: 401 });

  const { id } = await context.params;
  const project = await getProjectById(id);
  if (!project || !(await canDownloadProject(user, project))) {
    return NextResponse.json({ message: "原型不存在或无权下载" }, { status: 404 });
  }

  try {
    const html = project.sourceKind === "html";
    const content = html
      ? new Uint8Array(await readStoredFile(project.htmlPath))
      : await createPrototypeZip(await readStoredPrototypeBundle(project.htmlPath));
    const fileName = projectDownloadName(project);
    return new NextResponse(Buffer.from(content), {
      headers: {
        "Content-Type": html ? "text/html; charset=utf-8" : "application/zip",
        "Content-Disposition": attachmentDisposition(fileName),
        "Content-Length": String(content.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("原型下载生成失败", error);
    return NextResponse.json({ message: "下载文件生成失败，请稍后重试" }, { status: 500 });
  }
}
