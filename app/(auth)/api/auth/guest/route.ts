import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("redirectUrl") || "/";
  // Only allow relative same-origin paths — block open-redirect to external URLs.
  // A valid relative path starts with "/" but not "//" (which browsers treat as protocol-relative).
  const redirectUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return signIn("guest", { redirect: true, redirectTo: redirectUrl });
}
