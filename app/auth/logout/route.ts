import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseRouteClient } from "@/lib/auth/route-client";
import { getApplicationUrl } from "@/lib/environment";
import { assertCsrf } from "@/lib/security/csrf";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  try {
    assertCsrf(request, String(formData.get("csrf") ?? ""));
  } catch {
    return NextResponse.json({ error: "request_rejected" }, { status: 403 });
  }

  const { applyAuthState, supabase } = createSupabaseRouteClient(request);
  await supabase.auth.signOut({ scope: "local" });
  return applyAuthState(
    NextResponse.redirect(
      new URL("/login?status=logged-out", getApplicationUrl()),
      {
        status: 303,
      },
    ),
  );
}
