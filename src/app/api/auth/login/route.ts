import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withBasePath } from "@/lib/app-path";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { failureWindowStart, getClientIp } from "@/lib/security";
import { readRequestJson } from "@/lib/request-json";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

const schema = z.object({
  account: z.string().trim().min(2, "请输入账号").max(40),
  password: z.string().min(6, "请输入密码").max(128),
  returnTo: z.string().optional(),
});

function safeReturnTo(value?: string) {
  if (!value) return withBasePath("/projects");
  if (value.startsWith("/") && !value.startsWith("//")) return withBasePath(value);
  try {
    const url = new URL(value);
    if (url.origin === new URL(env.siteUrl).origin) return value;
  } catch {
    return withBasePath("/projects");
  }
  return withBasePath("/projects");
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await readRequestJson(request));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const account = parsed.data.account.toLowerCase();
  const ipAddress = getClientIp(request);

  const result = await query<{
    id: string;
    password_hash: string;
    status: "active" | "disabled";
    must_change_password: boolean;
    temp_password_expires_at: string | null;
    session_version: number;
  }>(
    `select id, password_hash, status, must_change_password, temp_password_expires_at, session_version
       from users where account = $1`,
    [account],
  );
  const user = result.rows[0];
  const recentFailures = await query<{ failures: number }>(
    `select count(*) as failures
       from login_logs
      where account = $1
        and ip_address is $2
        and success = false
        and created_at > $3`,
    [account, ipAddress, failureWindowStart()],
  );
  if (Number(recentFailures.rows[0]?.failures ?? 0) >= 10) {
    return NextResponse.json({ message: "登录失败次数过多，请 15 分钟后再试" }, { status: 429 });
  }
  const passwordValid = user ? await compare(parsed.data.password, user.password_hash) : false;
  const tempExpired = Boolean(
    user?.temp_password_expires_at &&
      new Date(user.temp_password_expires_at).getTime() <= Date.now(),
  );
  const valid = Boolean(user && passwordValid && user.status === "active" && !tempExpired);

  await query(
    `insert into login_logs (user_id, account, success, ip_address, user_agent)
     values ($1, $2, $3, $4, $5)`,
    [user?.id ?? null, account, valid, ipAddress, request.headers.get("user-agent")],
  );

  if (!valid) {
    const message = tempExpired ? "临时密码已过期，请联系管理员重新生成" : "账号或密码错误";
    return NextResponse.json({ message }, { status: 401 });
  }
  const response = NextResponse.json({
    next: user.must_change_password ? withBasePath("/change-password") : safeReturnTo(parsed.data.returnTo),
  });
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(user.id, user.session_version),
    sessionCookieOptions(),
  );
  return response;
}
