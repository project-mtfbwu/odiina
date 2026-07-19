import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { isValidIanaTimezone } from "@/lib/validation/timezone";

const preferencesSchema = z.object({
  timezone: z.string().min(1).max(255).refine(isValidIanaTimezone),
  weekStartsOn: z.number().int().min(0).max(6),
});

export async function PUT(request: NextRequest) {
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
    const input = preferencesSchema.parse(await request.json());
    const { error } = await auth.supabase
      .schema("app")
      .rpc("save_preferences", {
        p_iana_timezone: input.timezone,
        p_week_starts_on: input.weekStartsOn,
      });
    if (error) {
      throw error;
    }
    return auth.applyAuthState(NextResponse.json({ ok: true }));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return auth.applyAuthState(
      NextResponse.json(
        {
          error: "preferences_save_failed",
          message: code.includes("csrf")
            ? "The request could not be verified."
            : "Check the timezone and week-start value.",
        },
        { status: code.includes("csrf") ? 403 : 400 },
      ),
    );
  }
}
