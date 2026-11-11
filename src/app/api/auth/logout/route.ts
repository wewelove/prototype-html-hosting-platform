import { NextResponse } from "next/server";
import { withBasePath } from "@/lib/app-path";
import { env } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ next: withBasePath("/login") });
  response.cookies.set(SESSION_COOKIE, "", {
    expires: new Date(0),
    domain: env.authCookieDomain || undefined,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
  });
  return response;
}
