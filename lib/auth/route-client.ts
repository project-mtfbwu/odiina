import "server-only";

import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { forceHttpOnly } from "@/lib/auth/cookie-options";
import { getServerEnvironment } from "@/lib/environment";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

export function createSupabaseRouteClient(request: NextRequest) {
  const environment = getServerEnvironment();
  const pendingCookies: PendingCookie[] = [];
  let authHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        encode: "tokens-only",
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          pendingCookies.push(...cookiesToSet);
          authHeaders = { ...authHeaders, ...headers };
        },
      },
    },
  );

  function applyAuthState<T extends NextResponse>(response: T): T {
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, forceHttpOnly(options));
    }
    for (const [name, value] of Object.entries(authHeaders)) {
      response.headers.set(name, value);
    }
    response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0, must-revalidate",
    );
    return response;
  }

  return { applyAuthState, supabase };
}
