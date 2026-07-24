import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  authCookieOptions,
  csrfCookieName,
  csrfCookieOptions,
  forceHttpOnly,
} from "@/lib/auth/cookie-options";
import {
  getApplicationUrl,
  getServerEnvironment,
  hasSupabaseEnvironment,
} from "@/lib/environment";

const protectedPagePrefixes = [
  "/feed",
  "/entries",
  "/trash",
  "/settings",
  "/calendar",
  "/profile",
  "/search",
  "/tags",
  "/insights",
  "/reports",
  "/onboarding",
];

function isProtectedPage(pathname: string): boolean {
  return protectedPagePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function addPrivateHeaders(response: NextResponse): void {
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
}

export async function proxy(request: NextRequest) {
  if (!request.cookies.has(csrfCookieName)) {
    request.cookies.set(csrfCookieName, crypto.randomUUID());
  }

  let response = NextResponse.next({ request });
  response.cookies.set(
    csrfCookieName,
    request.cookies.get(csrfCookieName)!.value,
    csrfCookieOptions,
  );

  if (!hasSupabaseEnvironment()) {
    if (isProtectedPage(request.nextUrl.pathname)) {
      const loginUrl = new URL("/login", getApplicationUrl());
      loginUrl.searchParams.set("reason", "configuration");
      response = NextResponse.redirect(loginUrl);
    }
    addPrivateHeaders(response);
    return response;
  }

  const environment = getServerEnvironment();
  const supabase = createServerClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: authCookieOptions,
      cookies: {
        encode: "tokens-only",
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, forceHttpOnly(options));
          }
          for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims.sub);

  if (isProtectedPage(request.nextUrl.pathname) && !isAuthenticated) {
    const loginUrl = new URL("/login", environment.ODIINA_APP_URL);
    response = NextResponse.redirect(loginUrl);
  } else if (request.nextUrl.pathname === "/login" && isAuthenticated) {
    const feedUrl = new URL("/feed", environment.ODIINA_APP_URL);
    response = NextResponse.redirect(feedUrl);
  }

  if (
    isProtectedPage(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/api/") ||
    request.nextUrl.pathname.startsWith("/auth/")
  ) {
    addPrivateHeaders(response);
  }

  response.cookies.set(
    csrfCookieName,
    request.cookies.get(csrfCookieName)!.value,
    csrfCookieOptions,
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
