import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";

export async function withAiMutation(
  request: NextRequest,
  action: (
    supabase: Awaited<ReturnType<typeof verifiedRequestClient>>["supabase"],
  ) => Promise<unknown>,
) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const auth = await verifiedRequestClient(request);
  if (!auth.userId) {
    return auth.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  try {
    assertCsrf(request, request.headers.get("x-odiina-csrf") ?? "");
    const result = await action(auth.supabase);
    return auth.applyAuthState(NextResponse.json({ ok: true, result }));
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    const status = code.includes("csrf") ? 403 : 400;
    return auth.applyAuthState(
      NextResponse.json(
        { error: "ai_request_failed", message: safeErrorMessage(code) },
        { status },
      ),
    );
  }
}
