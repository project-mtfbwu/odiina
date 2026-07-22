import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";
import { activateMediaEntrySchema } from "@/lib/validation/media";

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
    const input = activateMediaEntrySchema.parse(await request.json());
    const parameters = {
      p_client_request_id: input.clientRequestId,
      p_entry_id: input.entryId,
      p_body_text: input.bodyText,
      p_attachment_ids: input.attachmentIds,
      p_occurred_at: input.occurredAt,
      p_occurred_timezone: input.occurredTimezone,
      p_occurred_local_date: input.occurredLocalDate,
      p_occurred_utc_offset_minutes: input.occurredUtcOffsetMinutes,
    };
    const { data, error } = input.place
      ? await context.supabase.schema("app").rpc("activate_media_entry_place", {
          ...parameters,
          p_place: input.place,
        })
      : await context.supabase
          .schema("app")
          .rpc("activate_media_entry", parameters);
    if (error) throw error;
    return context.applyAuthState(
      NextResponse.json((data as unknown[] | null)?.[0], { status: 201 }),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "activate_failed";
    return context.applyAuthState(
      NextResponse.json(
        {
          error: "media_entry_activate_failed",
          message: safeErrorMessage(code),
        },
        { status: code.includes("csrf") ? 403 : 400 },
      ),
    );
  }
}
