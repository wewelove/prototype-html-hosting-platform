import { isIP } from "node:net";

export function getClientIp(request: Request) {
  const candidate = (
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
  return candidate && isIP(candidate) ? candidate : null;
}

/** 登录与分享密码校验共用的失败次数统计窗口。 */
export const FAILURE_WINDOW_MINUTES = 15;

/** 失败次数统计窗口的起始时间，统一使用 ISO 时间字符串与数据库文本字段比较。 */
export function failureWindowStart(now = Date.now()) {
  return new Date(now - FAILURE_WINDOW_MINUTES * 60_000).toISOString();
}
