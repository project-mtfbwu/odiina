import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
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
    const { data, error } = await context.supabase
      .schema("app")
      .rpc("cancel_image_upload", { p_attachment_id: attachmentId });
    if (error) throw error;
    const object = (
      data as { bucket_id: string; object_key: string }[] | null
    )?.[0];
    if (object) {
      await context.supabase.storage
        .from(object.bucket_id)
        .remove([object.object_key]);
      await context.supabase
        .schema("app")
        .rpc("mark_cancelled_object_deleted", {
          p_attachment_id: attachmentId,
        });
    }
    return context.applyAuthState(
      NextResponse.json(
        { cancelled: true },
        { headers: { "cache-control": "private, no-store" } },
      ),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "cancel_failed";
    return context.applyAuthState(
      NextResponse.json(
        { error: "image_cancel_failed" },
        { status: code.includes("csrf") ? 403 : 400 },
      ),
    );
  }
}
