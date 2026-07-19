import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { reviseEntry } from "@/lib/database/mutations";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";
import { reviseEntrySchema } from "@/lib/validation/entry";

const parameterSchema = z.uuid();

export async function PATCH(
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
    const entryId = parameterSchema.parse((await context.params).entryId);
    const input = reviseEntrySchema.parse(await request.json());
    const result = await reviseEntry(auth.supabase, entryId, input);
    return auth.applyAuthState(NextResponse.json(result));
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : undefined;
    const status = code?.includes("conflict")
      ? 409
      : code?.includes("csrf")
        ? 403
        : 400;
    return auth.applyAuthState(
      NextResponse.json(
        { error: "entry_revision_failed", message: safeErrorMessage(code) },
        { status },
      ),
    );
  }
}
