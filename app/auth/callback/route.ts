import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectDestination } from "@/lib/auth/redirects";
import { createSupabaseRouteClient } from "@/lib/auth/route-client";
import { getApplicationUrl } from "@/lib/environment";

export async function GET(request: NextRequest) {
  const applicationUrl = getApplicationUrl();
  const code = request.nextUrl.searchParams.get("code");
  const destination = safeRedirectDestination(
    request.nextUrl.searchParams.get("next"),
  );
  const { applyAuthState, supabase } = createSupabaseRouteClient(request);

  if (!code) {
    return applyAuthState(
      NextResponse.redirect(
        new URL("/login?error=invalid-link", applicationUrl),
      ),
    );
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return applyAuthState(
      NextResponse.redirect(
        new URL("/login?error=invalid-link", applicationUrl),
      ),
    );
  }

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) {
    return applyAuthState(
      NextResponse.redirect(new URL("/login?error=session", applicationUrl)),
    );
  }

  return applyAuthState(
    NextResponse.redirect(new URL(destination, applicationUrl)),
  );
}
