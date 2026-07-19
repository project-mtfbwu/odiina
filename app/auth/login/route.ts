import { NextResponse, type NextRequest } from "next/server";

import { csrfCookieName } from "@/lib/auth/cookie-options";
import { createSupabaseRouteClient } from "@/lib/auth/route-client";
import { getApplicationUrl } from "@/lib/environment";
import { assertCsrf } from "@/lib/security/csrf";
import {
  localRateLimiter,
  privacySafeRateLimitKey,
} from "@/lib/security/rate-limit";

const genericDestination = "/login?status=check-email";

export async function POST(request: NextRequest) {
  const applicationUrl = getApplicationUrl();
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const csrf = String(formData.get("csrf") ?? "");

  try {
    assertCsrf(request, csrf);
  } catch {
    return NextResponse.redirect(
      new URL("/login?error=request", applicationUrl),
      { status: 303 },
    );
  }

  const clientAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = localRateLimiter.take(
    privacySafeRateLimitKey(`${clientAddress}|${email}`),
    5,
    15 * 60,
  );

  if (!limit.allowed) {
    const response = NextResponse.redirect(
      new URL(genericDestination, applicationUrl),
      { status: 303 },
    );
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const { applyAuthState, supabase } = createSupabaseRouteClient(request);
  const callback = new URL("/auth/callback", applicationUrl);
  callback.searchParams.set("next", "/feed");

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Deliberately ignore the provider response to prevent account enumeration.
    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callback.toString(),
        shouldCreateUser: false,
      },
    });
  }

  const response = NextResponse.redirect(
    new URL(genericDestination, applicationUrl),
    { status: 303 },
  );
  response.cookies.set(
    csrfCookieName,
    request.cookies.get(csrfCookieName)?.value ?? crypto.randomUUID(),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  );
  return applyAuthState(response);
}
