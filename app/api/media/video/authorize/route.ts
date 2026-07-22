import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { authorizeVideoUpload } from "@/lib/database/media";
import { getStorageTusEndpoint } from "@/lib/environment";
import { featureFlags } from "@/lib/feature-flags";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";
import { authorizeVideoSchema } from "@/lib/validation/media";

export async function POST(request: NextRequest) {
  if (!featureFlags.videoUploads) {
    return NextResponse.json(
      { error: "video_uploads_disabled" },
      { status: 404 },
    );
  }
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
    const input = authorizeVideoSchema.parse(await request.json());
    const authorization = await authorizeVideoUpload(context.supabase, input);
    const { data, error } = await context.supabase.storage
      .from(authorization.bucket_id)
      .createSignedUploadUrl(authorization.object_key);
    if (error || !data?.token)
      throw error ?? new Error("odiina_signed_upload_missing");
    const marked = await context.supabase
      .schema("app")
      .rpc("mark_video_uploading", {
        p_attachment_id: authorization.attachment_id,
      });
    if (marked.error) throw marked.error;
    return context.applyAuthState(
      NextResponse.json(
        {
          entryId: authorization.entry_id,
          attachmentId: authorization.attachment_id,
          uploadEndpoint: getStorageTusEndpoint().toString(),
          uploadToken: data.token,
          bucketName: authorization.bucket_id,
          objectName: authorization.object_key,
        },
        { status: 201, headers: { "cache-control": "private, no-store" } },
      ),
    );
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "video_authorize_failed";
    return context.applyAuthState(
      NextResponse.json(
        { error: "video_authorize_failed", message: safeErrorMessage(code) },
        { status: code.includes("csrf") ? 403 : 400 },
      ),
    );
  }
}
