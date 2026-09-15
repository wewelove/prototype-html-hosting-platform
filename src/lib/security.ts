import { isIP } from "node:net";
import { env } from "@/lib/env";

export function getClientIp(request: Request) {
  const candidate = (
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
  return candidate && isIP(candidate) ? candidate : null;
}

export function isAllowedMutationOrigin(request: Request) {
  if (process.env.NODE_ENV !== "production") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  // 原型运行在独立域名，不能携带登录态调用管理端写接口。
  try {
    return origin === new URL(env.manageUrl).origin;
  } catch {
    return false;
  }
}

export function isAllowedViewerMutationOrigin(request: Request) {
  if (process.env.NODE_ENV !== "production") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return origin === new URL(env.demoUrl).origin;
  } catch {
    return false;
  }
}

export function rejectInvalidViewerOrigin(request: Request) {
  if (isAllowedViewerMutationOrigin(request)) return null;
  return Response.json({ message: "请求来源校验失败" }, { status: 403 });
}

export function rejectInvalidOrigin(request: Request) {
  if (isAllowedMutationOrigin(request)) return null;
  return Response.json({ message: "请求来源校验失败" }, { status: 403 });
}

/** 登录与分享密码校验共用的失败次数统计窗口。 */
export const FAILURE_WINDOW_MINUTES = 15;

/** 失败次数统计窗口的起始时间，统一使用 ISO 时间字符串与数据库文本字段比较。 */
export function failureWindowStart(now = Date.now()) {
  return new Date(now - FAILURE_WINDOW_MINUTES * 60_000).toISOString();
}
