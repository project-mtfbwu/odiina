import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { createEntry } from "@/lib/database/mutations";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";
import { createEntrySchema } from "@/lib/validation/entry";

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
    const input = createEntrySchema.parse(await request.json());
    const result = await createEntry(context.supabase, input);
    return context.applyAuthState(NextResponse.json(result, { status: 201 }));
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : undefined;
    const status = code?.includes("csrf") ? 403 : 400;
    return context.applyAuthState(
      NextResponse.json(
        { error: "entry_create_failed", message: safeErrorMessage(code) },
        { status },
      ),
    );
  }
}
