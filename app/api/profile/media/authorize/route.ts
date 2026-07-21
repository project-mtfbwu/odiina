import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { authorizeProfileImageUpload } from "@/lib/database/media";
import { getStorageTusEndpoint } from "@/lib/environment";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";
import { authorizeProfileImageSchema } from "@/lib/validation/profile";

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
    const input = authorizeProfileImageSchema.parse(await request.json());
    const authorization = await authorizeProfileImageUpload(
      context.supabase,
      input,
    );
    const { data, error } = await context.supabase.storage
      .from(authorization.bucket_id)
      .createSignedUploadUrl(authorization.object_key);
    if (error || !data?.token) {
      throw error ?? new Error("odiina_signed_upload_missing");
    }
    const { error: stateError } = await context.supabase
      .schema("app")
      .rpc("mark_image_uploading", {
        p_attachment_id: authorization.attachment_id,
      });
    if (stateError) throw stateError;
    return context.applyAuthState(
      NextResponse.json(
        {
          attachmentId: authorization.attachment_id,
          uploadEndpoint: getStorageTusEndpoint().toString(),
          uploadToken: data.token,
          bucketName: authorization.bucket_id,
          objectName: authorization.object_key,
        },
        {
          status: 201,
          headers: { "cache-control": "private, no-store" },
        },
      ),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "upload_invalid";
    return context.applyAuthState(
      NextResponse.json(
        {
          error: "profile_image_authorize_failed",
          message: safeErrorMessage(code),
        },
        {
          status: code.includes("csrf") ? 403 : 400,
          headers: { "cache-control": "private, no-store" },
        },
      ),
    );
  }
}
