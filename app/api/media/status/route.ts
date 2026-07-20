import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { attachmentStatusSchema } from "@/lib/validation/media";

export async function GET(request: NextRequest) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const context = await verifiedRequestClient(request);
  if (!context.userId) {
    return context.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  const parsed = attachmentStatusSchema.safeParse({
    attachmentIds: request.nextUrl.searchParams.getAll("id"),
  });
  if (!parsed.success) {
    return context.applyAuthState(
      NextResponse.json({ error: "invalid_attachment_ids" }, { status: 400 }),
    );
  }
  const { data, error } = await context.supabase
    .schema("app")
    .from("attachments")
    .select(
      "id,state,error_code,media_processing_jobs(status,stage,last_error_code)",
    )
    .in("id", parsed.data.attachmentIds);
  if (error) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_status_failed" }, { status: 500 }),
    );
  }
  return context.applyAuthState(
    NextResponse.json(
      { attachments: data ?? [] },
      { headers: { "cache-control": "private, no-store" } },
    ),
  );
}
