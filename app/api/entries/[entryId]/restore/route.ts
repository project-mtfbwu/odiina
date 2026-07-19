import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ entryId: string }> },
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
    const entryId = z.uuid().parse((await context.params).entryId);
    const { error } = await auth.supabase.schema("app").rpc("restore_entry", {
      p_entry_id: entryId,
    });
    if (error) {
      throw error;
    }
    return auth.applyAuthState(NextResponse.json({ ok: true }));
  } catch (error) {
    const code = error instanceof Error ? error.message : undefined;
    return auth.applyAuthState(
      NextResponse.json(
        { error: "entry_restore_failed", message: safeErrorMessage(code) },
        { status: code?.includes("csrf") ? 403 : 400 },
      ),
    );
  }
}
