import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { finalizeImageUpload } from "@/lib/database/media";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";
import { attachmentCommandSchema } from "@/lib/validation/media";

export async function POST(request: NextRequest) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const context = await verifiedRequestClient(request);
  if (!context.userId) {
    return context.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  try {
    assertCsrf(request, request.headers.get("x-odiina-csrf") ?? "");
    const { attachmentId } = attachmentCommandSchema.parse(
      await request.json(),
    );
    const result = await finalizeImageUpload(context.supabase, attachmentId);
    return context.applyAuthState(
      NextResponse.json(result, {
        headers: { "cache-control": "private, no-store" },
      }),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "finalize_failed";
    return context.applyAuthState(
      NextResponse.json(
        { error: "image_finalize_failed", message: safeErrorMessage(code) },
        { status: code.includes("csrf") ? 403 : 400 },
      ),
    );
  }
}
